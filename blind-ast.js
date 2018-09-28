const { execFile: _execFile } = require('child_process')
const promisify = require('util').promisify
const execFile = promisify(_execFile)

const fs = require('fs').promises
const { join, extname, resolve, basename } = require('path')
const async = require('async')
const mkdirp = require('mkdirp').sync
const tmpdirSync = require('tmp').dirSync

const { readGzFile } = require('./inspector')

const COMMIT_FILTER = (commit, repo) =>
    repo.language === 'C'
    && commit.files.length > 0
    && commit.stats.additions <= 30
    && commit.files.find(file => extname(file.filename).toLowerCase() === '.c')

function asyncMap(coll, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(coll, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

function generateAst(filepath, cwd) {
    return execFile('clang', [
        '-cc1',

        // common include path
        '-I', '.',
        '-I', 'src',

        '-ast-dump',
        filepath
    ], { maxBuffer: 64 * 1024 * 1024, cwd }).then(
        ret => ret,    // { stdout, stderr }
        error => ({ error, stdout: error.stdout, stderr: error.stderr })
    )
}

function flattenFilename(filename) {
    return filename.replace(/\//g, '__')
}

module.exports = async function(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    const BASE_OUTPUT_DIR = resolve(process.cwd(), opts.outputDir)
    const BASE_CACHE_DIR = opts.cacheDir ? resolve(process.cwd(), opts.cacheDir) : null

    let nStarted = 0
    let nOk = 0
    let nFullAst = 0
    let nPartialAst = 0
    let nSeriousError = 0

    const buildingCache = {}

    await asyncMap(
        commitFiles,
        require('os').cpus().length,
        async filename => {
            const {
                commit,
                repo
            } = await readGzFile(join(commitDir, filename), 'utf-8').then(str => JSON.parse(str))

            if (!COMMIT_FILTER(commit, repo)) {
                console.log(`skip: ${repo.full_name} ${commit.sha}`)
                return null
            }

            const workingDir = tmpdirSync({ unsafeCleanup: true })
            nStarted += 1

            try {
                let nVulnAst = 0
                let nFixedAst = 0
                let nError = 0

                console.log(`${repo.full_name} ${commit.sha}: start clone -> ${workingDir.name}`)

                const COMMIT_DIR = repo.full_name.replace(/\//g, '__') + '__' + commit.sha
                const OUTPUT_DIR = join(BASE_OUTPUT_DIR, COMMIT_DIR)
                mkdirp(OUTPUT_DIR)

                if (BASE_CACHE_DIR) {
                    // create repo cache
                    const cachedRepoDir = join(BASE_CACHE_DIR, repo.full_name)
                    const cacheRepoExists = await fs.access(cachedRepoDir).then(_ => true, _ => false)
                    if (!cacheRepoExists && !buildingCache[repo.full_name]) {
                        // not in cache, not building, fetch to cache dir
                        mkdirp(cachedRepoDir)
                        console.log(`${repo.full_name} cache miss`)
                        buildingCache[repo.full_name] = execFile('git', [
                                'clone',
                                repo.clone_url,
                                cachedRepoDir
                            ], { maxBuffer: 64 * 1024 * 1024, cwd: workingDir.name }
                        )
                        await buildingCache[repo.full_name]
                        delete buildingCache[repo.full_name]
                        console.log(`${repo.full_name} cache built`)
                    } else {
                        if (buildingCache[repo.full_name]) {
                            console.log(`${repo.full_name} waiting for cache completion`)
                            await buildingCache[repo.full_name]
                            console.log(`${repo.full_name} cache built, resume`)
                        } else {
                            console.log(`${repo.full_name} cache hit`)
                        }
                    }

                    // clone cache to working dir
                    await execFile('git', [
                        'clone',
                        cachedRepoDir,
                        workingDir.name
                    ], { maxBuffer: 64 * 1024 * 1024, cwd: workingDir.name })
                } else {
                    await execFile('git', [
                        'clone',
                        repo.clone_url,
                        workingDir.name
                    ], { maxBuffer: 64 * 1024 * 1024, cwd: workingDir.name })
                }

                const sources = commit.files.filter(file =>
                    extname(file.filename).toLowerCase() === '.c'
                    && file.status === 'modified'
                )

                // compile vuln version
                await execFile('git', [
                    'checkout',
                    '-f',
                    commit.parents[0].sha
                ], { cwd: workingDir.name })

                for (const f of sources) {
                    const {
                        error,
                        stdout,
                        stderr
                    } = await generateAst(f.filename, workingDir.name)

                    nError += error ? 1 : 0

                    if (stderr.length > 0) {
                        await fs.writeFile(
                            join(OUTPUT_DIR, 'vuln__' + flattenFilename(f.filename) + '.stderr.txt'),
                            stderr
                        )
                    }
                    if (stdout.length > 2) {
                        nVulnAst += 1
                        await fs.writeFile(
                            join(OUTPUT_DIR, 'vuln__' + flattenFilename(f.filename) + '.ast.txt'),
                            stdout
                        )
                    }

                    console.log(`${repo.full_name} ${commit.sha}: compile parent, ${f.filename}, ${error ? 'errored' : 'ok'}`)
                }

                // compile fixed version
                await execFile('git', [
                    'checkout',
                    '-f',
                    commit.sha
                ], { cwd: workingDir.name })

                for (const f of sources) {
                    const {
                        error,
                        stdout,
                        stderr
                    } = await generateAst(f.filename, workingDir.name)

                    nError += error ? 1 : 0

                    if (stderr.length > 0) {
                        await fs.writeFile(
                            join(OUTPUT_DIR, 'fixed__' + flattenFilename(f.filename) + '.stderr.txt'),
                            stderr
                        )
                    }

                    if (stdout.length > 2) {
                        nFixedAst += 1
                        await fs.writeFile(
                            join(OUTPUT_DIR, 'fixed__' + flattenFilename(f.filename) + '.ast.txt'),
                            stdout
                        )
                    }

                    console.log(`${repo.full_name} ${commit.sha}: compile current, ${f.filename}, ${error ? 'errored' : 'ok'}`)
                }

                console.log(`${repo.full_name} ${commit.sha}: nVulnAst = ${nVulnAst}, nFixedAst = ${nFixedAst}, nError = ${nError}`)
                nOk += (nError === 0 ? 1 : 0)
                nFullAst += (nVulnAst === nFixedAst && nVulnAst === sources.length ? 1 : 0)
                nPartialAst += (nVulnAst !== nFixedAst || nVulnAst !== sources.length ? 1 : 0)
            } catch(e) {
                console.log(`Error: ${repo.full_name} ${commit.sha}: ${e.message}`)
                console.log(`    ${e.stack}`)
                nSeriousError += 1
            } finally {
                workingDir.removeCallback()
            }
        }
    )

    console.log(`nOk = ${nOk}, nFullAst = ${nFullAst}, nPartialAst = ${nPartialAst}, nSeriousError = ${nSeriousError} / nStarted = ${nStarted}`)
}
