const { execFile: _execFile } = require('child_process')
const promisify = require('util').promisify
const execFile = promisify(_execFile)

const fs = require('fs').promises
const { join, extname, resolve, basename } = require('path')
const async = require('async')
const mkdirp = require('mkdirp').sync
const tmpdirSync = require('tmp').dirSync

const { readGzFile } = require('./inspector')

function asyncMap(coll, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(coll, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

function extractPatchHeadings(diff) {
    return [
        ...new Set(
            diff.split(/\n/g)
                .filter(line => line.startsWith('@@') && line.slice(2).includes('@@'))
                .map(line => line.slice(2 + line.slice(2).indexOf('@@') + 2).trim())
        )
    ]
}

function guessFunctionNameFromHeader(header) {
    const idxParn = header.indexOf('(')
    if (idxParn >= 0) {
        const idxLastSpace = Math.max(header.slice(0, idxParn).lastIndexOf(' '), 0)
        return header.slice(idxLastSpace, idxParn).replace(/[^a-zA-Z0-9_]/g, '')
    } else {
        // can not guess
        return header
    }
}

function extractFunctionNameFromBody(body) {
    // TODO: write a correct C function header parser
}

// write to isolated function file
function extractFunctionFromHeaders(file, headers) {
    return fs.readFile(file, {encoding: 'utf-8'}).then(buf => {
        let ret = []
        const lines = buf.split(/[\n\r]+/)
        for (let i = 0; i < lines.length; ++i) {
            const header = headers.find(header => lines[i].includes(header))
            if (!header) continue

            // start extraction based on bracket level / depth
            let fnBody = ''
            let bracketLevel = 0
            let encounteredFirstBracket = false
            while (
                i < lines.length
                && (!encounteredFirstBracket || bracketLevel > 0)
            ) {
                for (const ch of lines[i]) {
                    if (ch === '{') {
                        bracketLevel += 1
                        encounteredFirstBracket = true
                    }
                    if (ch === '}') {
                        bracketLevel -= 1
                    }
                }
                fnBody += (lines[i] + '\n')
                ++i
            }

            ret.push({
                name: guessFunctionNameFromHeader(header),
                body: fnBody
            })
        }
        return ret
    })
}

module.exports = async function(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    const BASE_OUTPUT_DIR = resolve(process.cwd(), opts.outputDir)
    const BASE_CACHE_DIR = opts.cacheDir ? resolve(process.cwd(), opts.cacheDir) : null

    const buildingCache = {}

    await asyncMap(
        commitFiles,
        require('os').cpus().length,
        async filename => {
            const {
                commit,
                repo
            } = await readGzFile(join(commitDir, filename), 'utf-8').then(str => JSON.parse(str))

            const workingDir = tmpdirSync({ unsafeCleanup: true })

            try {
                // console.log(`${repo.full_name} ${commit.sha}: start clone -> ${workingDir.name}`)

                const OUTPUT_DIR = join(BASE_OUTPUT_DIR, repo.full_name)
                mkdirp(OUTPUT_DIR)

                if (BASE_CACHE_DIR) {
                    // create repo cache
                    const cachedRepoDir = join(BASE_CACHE_DIR, repo.full_name)
                    const cacheRepoExists = await fs.access(cachedRepoDir).then(_ => true, _ => false)
                    if (!cacheRepoExists && !buildingCache[repo.full_name]) {
                        // not in cache, not building, fetch to cache dir
                        mkdirp(cachedRepoDir)
                        // console.log(`${repo.full_name} cache miss`)
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
                            // console.log(`${repo.full_name} cache hit`)
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

                // extract vuln version
                await execFile('git', [
                    'checkout',
                    '-f',
                    commit.parents[0].sha
                ], { cwd: workingDir.name })

                for (const f of sources) {
                    const fns = await extractFunctionFromHeaders(
                        join(workingDir.name, f.filename),
                        extractPatchHeadings(f.patch).filter(h => h.includes('('))
                    )

                    for (const {name, body} of fns) {
                        console.log(`Extracted\t${repo.full_name} ${commit.sha}: (vuln) ${name}`)
                        await fs.writeFile(
                            join(OUTPUT_DIR, `${name}__${commit.sha}__vulnerable.txt`),
                            body
                        )
                    }
                }

                // extract fixed version
                await execFile('git', [
                    'checkout',
                    '-f',
                    commit.sha
                ], { cwd: workingDir.name })

                for (const f of sources) {
                    const fns = await extractFunctionFromHeaders(
                        join(workingDir.name, f.filename),
                        extractPatchHeadings(f.patch).filter(h => h.includes('('))
                    )

                    for (const {name, body} of fns) {
                        console.log(`Extracted\t${repo.full_name} ${commit.sha}: (fixed) ${name}`)
                        await fs.writeFile(
                            join(OUTPUT_DIR, `${name}__${commit.sha}__fixed.txt`),
                            body
                        )
                    }
                }
            } catch(e) {
                console.log(`Error: ${repo.full_name} ${commit.sha}: ${e.message}`)
                console.log(`    ${e.stack}`)
            } finally {
                workingDir.removeCallback()
            }
        }
    )
}
