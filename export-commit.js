const fs = require('fs').promises
const { createWriteStream } = require('fs')
const { join, extname, resolve } = require('path')
const async = require('async')
const mkdirp = require('mkdirp').sync
const tmpdirSync = require('tmp').dirSync
const BloomFilter = require('bloom-filter')

const { readGzFile } = require('./inspector')
const { fetchRepositoryTo } = require('./lib/repo-cache')
const { checkout: gitCheckout } = require('./lib/git-call')

function asyncMap(coll, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(coll, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

const Extraction = require('./extraction')
const hasInterestingFiles = files => {
    for (const f of files) {
        const extensionSignature = extname(f.filename).slice(1).toLowerCase()
        if (extensionSignature in Extraction) return true
    }
    return false
}

module.exports = async function(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    const BASE_OUTPUT_DIR = resolve(process.cwd(), opts.outputDir)
    const BASE_CACHE_DIR = opts.cacheDir ? resolve(process.cwd(), opts.cacheDir) : null

    mkdirp(BASE_OUTPUT_DIR)

    const {
        isInBloomFilter,
        addToBloomFilter,
        writeToBloomFilterLog,
    } = (() => {
        if (!opts.bloomFilter) {
            return {
                isInBloomFilter: () => false,
                addToBloomFilter: () => undefined,
                writeToBloomFilterLog: () => undefined,
            }
        }
        const bloomFilter = BloomFilter.create(1e7, 1e-5)    // may miss 100 items in 10,000,000
        const bloomFilterLog = createWriteStream(join(BASE_OUTPUT_DIR, 'duplicate-commits.txt'))
        return {
            isInBloomFilter: str => bloomFilter.contains(str),
            addToBloomFilter: str => bloomFilter.insert(str),
            writeToBloomFilterLog: msg => bloomFilterLog.write(`${msg}\n`)
        }
    })()

    await asyncMap(
        commitFiles,
        require('os').cpus().length,
        async filename => {
            const {
                commit,
                repo
            } = await readGzFile(join(commitDir, filename), 'utf-8').then(str => JSON.parse(str))

            // skip large diff (likely to be a huge merge)
            if (commit.stats.total > 20) return

            // skip commits without files of interest
            if (!hasInterestingFiles(commit.files)) return

            // second stage deduplication, check commit time and header line
            const { committer, message } = commit.commit
            const commitSignature = `${committer.date} ${message.slice(0, message.indexOf('\n'))}`
            if (isInBloomFilter(commitSignature)) {
                writeToBloomFilterLog(`${repo.full_name}\t${commit.sha}\t${commitSignature}`)
                return
            } else {
                addToBloomFilter(commitSignature)
            }

            const workingDir = tmpdirSync({ unsafeCleanup: true })

            try {
                // console.log(`${repo.full_name} ${commit.sha}: start clone -> ${workingDir.name}`)

                const OUTPUT_DIR = join(BASE_OUTPUT_DIR, repo.full_name)
                mkdirp(OUTPUT_DIR)

                await fetchRepositoryTo(
                    repo.clone_url,
                    repo.full_name,
                    workingDir.name,
                    BASE_CACHE_DIR
                )

                // candicate files (those modified by patch, ignore add / delete)
                const sources = commit.files.filter(file => file.status === 'modified')

                async function extractFunctionFromFiles(files, label, commit) {
                    for (const f of files) {
                        const extensionSignature = extname(f.filename).slice(1).toLowerCase()
                        if (!Extraction[extensionSignature]) continue

                        const {
                            extractFunctionFromHeaders,
                            extractFunctionPatchHeadings
                        } = Extraction[extensionSignature]

                        const fns = await extractFunctionFromHeaders(
                            join(workingDir.name, f.filename),
                            extractFunctionPatchHeadings(f.patch)
                        )

                        for (const {name, body} of fns) {
                            console.log(`Extracted\t${repo.full_name} ${commit}: (${label}) ${name}`)
                            await fs.writeFile(
                                join(OUTPUT_DIR, `${name}__${commit}__${label}.txt`),
                                body
                            )
                        }
                    }
                }

                // extract vuln version
                await gitCheckout(commit.parents[0].sha, workingDir.name)
                await extractFunctionFromFiles(sources, 'vulne', commit.parents[0].sha)

                // extract fixed version
                await gitCheckout(commit.sha, workingDir.name)
                await extractFunctionFromFiles(sources, 'fixed', commit.sha)

            } catch(e) {
                console.log(`Error: ${repo.full_name} ${commit.sha}: ${e.message}`)
                console.log(`    ${e.stack}`)
            } finally {
                workingDir.removeCallback()
            }
        }
    )
}
