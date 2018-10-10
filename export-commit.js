const fs = require('fs').promises
const { createWriteStream } = require('fs')
const { join, extname, resolve } = require('path')
const async = require('async')
const mkdirp = require('mkdirp').sync
const BloomFilter = require('bloom-filter')

const { readGzFile } = require('./inspector')
const urlFetch = require('./lib/url-fetch')

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
        1,    // do not run parallel fetch
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
            const { author, message } = commit.commit
            const commitSignature = `${author.date} ${message.slice(0, message.indexOf('\n'))}`
            if (isInBloomFilter(commitSignature)) {
                writeToBloomFilterLog(`${repo.full_name}\t${commit.sha}\t${commitSignature}`)
                return
            } else {
                addToBloomFilter(commitSignature)
            }

            try {
                const OUTPUT_DIR = join(BASE_OUTPUT_DIR, repo.full_name)
                mkdirp(OUTPUT_DIR)

                // candicate files (those modified by patch, ignore add / delete)
                const sources = commit.files.filter(file => file.status === 'modified')

                for (const f of sources) {
                    const extensionSignature = extname(f.filename).slice(1).toLowerCase()
                    if (!Extraction[extensionSignature]) continue

                    const {
                        extractFunctionFromHeaders,
                        extractFunctionPatchHeadings
                    } = Extraction[extensionSignature]

                    const parentSha = commit.parents[0].sha

                    const vulneFileBuf = await urlFetch(`https://github.com/${repo.full_name}/raw/${parentSha}/${f.filename}`)
                    const fixedFileBuf = await urlFetch(`https://github.com/${repo.full_name}/raw/${commit.sha}/${f.filename}`)

                    const pairs = await extractFunctionFromHeaders(vulneFileBuf, fixedFileBuf, extractFunctionPatchHeadings(f.patch))

                    for (const {name, before, after} of pairs) {
                        console.log(`Extracted\t${repo.full_name} ${commit.sha} ${name}`)
                        await fs.writeFile(
                            join(OUTPUT_DIR, `${name}__${commit.sha}__vulne.txt`),
                            before
                        )
                        await fs.writeFile(
                            join(OUTPUT_DIR, `${name}__${commit.sha}__fixed.txt`),
                            after
                        )
                    }
                }
            } catch(e) {
                console.log(`Error: ${repo.full_name} ${commit.sha} ${e.message}`)
                console.log(`    ${e.stack}`)
            }
        }
    )
}
