const { execFile: _execFile } = require('child_process')
const promisify = require('util').promisify
const execFile = promisify(_execFile)

const fs = require('fs').promises
const { join, extname, resolve } = require('path')
const mkdirp = require('mkdirp').sync
const tmpdirSync = require('tmp').dirSync

const { readGzJson, isGzJson } = require('./lib/read-gz')
const asyncMap = require('./lib/async-map')

const { fetchRepositoryTo } = require('./lib/repo-cache')
const { checkout: gitCheckout } = require('./lib/git-call')

// filter commits to extract here
// by default, extract C files in C projects that has less than 30 lines of modification
const COMMIT_FILTER = (commit, repo) =>
    repo.language === 'C'
    && commit.files.length > 0
    && commit.stats.additions <= 30
    && commit.files.find(file => extname(file.filename).toLowerCase() === '.c')

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

function sum(a) {
    return a.reduce((a,v) => a+v, 0)
}

/*
 * Clang Blind Ast build,
 *
 * Requires clang binaries to be installed
 * Recommends to set up ramdisk, see README.md
 */
module.exports = async function ghdcBlindAst(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    const BASE_OUTPUT_DIR = resolve(process.cwd(), opts.outputDir)
    const BASE_CACHE_DIR = opts.cacheDir ? resolve(process.cwd(), opts.cacheDir) : null

    let nStarted = 0
    let nOk = 0
    let nFullAst = 0
    let nSeriousError = 0
    let nAstDiff = 0

    await asyncMap(
        commitFiles.filter(isGzJson),
        require('os').cpus().length,
        async filename => {
            const { commit, repo } = await readGzJson(join(commitDir, filename))

            // filter unwanted commits
            if (!COMMIT_FILTER(commit, repo)) {
                console.log(`skip: ${repo.full_name} ${commit.sha}`)
                return null
            }

            // create working path
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

                await fetchRepositoryTo(
                    repo.clone_url,
                    repo.full_name,
                    workingDir.name,
                    BASE_CACHE_DIR
                )

                const sources = commit.files.filter(file =>
                    extname(file.filename).toLowerCase() === '.c'
                    && file.status === 'modified'
                )

                // compile vuln version
                await gitCheckout(commit.parents[0].sha, workingDir.name)

                let vulnSize = []

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
                        vulnSize.push(stdout.length)
                        await fs.writeFile(
                            join(OUTPUT_DIR, 'vuln__' + flattenFilename(f.filename) + '.ast.txt'),
                            stdout
                        )
                    }

                    console.log(`${repo.full_name} ${commit.sha}: compile parent, ${f.filename}, ${error ? 'errored' : 'ok'}`)
                }

                // compile fixed version
                await gitCheckout(commit.sha, workingDir.name)

                let fixedSize = []

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
                        fixedSize.push(stdout.length)
                        await fs.writeFile(
                            join(OUTPUT_DIR, 'fixed__' + flattenFilename(f.filename) + '.ast.txt'),
                            stdout
                        )
                    }

                    console.log(`${repo.full_name} ${commit.sha}: compile current, ${f.filename}, ${error ? 'errored' : 'ok'}`)
                }

                console.log(`${repo.full_name} ${commit.sha}: nVulnAst = ${nVulnAst}, nFixedAst = ${nFixedAst}, nError = ${nError}, AstDiff = ${sum(vulnSize)}/${sum(fixedSize)}`)
                nOk += (nError === 0 ? 1 : 0)
                nFullAst += (nVulnAst === nFixedAst && nVulnAst === sources.length ? 1 : 0)
                nAstDiff += (sum(vulnSize) !== sum(fixedSize) ? 1 : 0)
            } catch(e) {
                console.log(`Error: ${repo.full_name} ${commit.sha}: ${e.message}`)
                console.log(`    ${e.stack}`)
                nSeriousError += 1
            } finally {
                workingDir.removeCallback()
            }
        }
    )

    console.log(`nOk = ${nOk}, nFullAst = ${nFullAst}, nAstDiff = ${nAstDiff}, nSeriousError = ${nSeriousError} / nStarted = ${nStarted}`)
}
