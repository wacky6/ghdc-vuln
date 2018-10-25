const fs = require('fs').promises
const { join, extname, resolve } = require('path')
const asyncMap = require('./lib/async-map')
const mkdirp = require('mkdirp').sync
const BloomFilter = require('bloom-filter')
const { readGzJson, isGzJson } = require('./lib/read-gz')
const urlFetch = require('./lib/url-fetch')
const Extraction = require('./extraction')

// filter files to extract here
// by default, all files that has a corresponding extraction module will be extracted
const hasInterestingFiles = files => {
    for (const f of files) {
        const extensionSignature = extname(f.filename).slice(1).toLowerCase()
        if (extensionSignature in Extraction) return true
    }
    return false
}

// the maximum commit (changes of lines) to consider for extraction
// commits that modifies more than LARGE_DIFF_LIMIT lines are skipped
const LARGE_DIFF_LIMIT = 20

// perform extraction on commit
// output extracted file to destination
module.exports = async function ghdcExportCommit(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    const OUTPUT_DIR = resolve(process.cwd(), opts.outputDir)
    mkdirp(OUTPUT_DIR)

    const {
        isInBloomFilter,
        addToBloomFilter,
    } = (() => {
        if (!opts.bloomFilter) {
            return {
                isInBloomFilter: () => false,
                addToBloomFilter: () => undefined,
            }
        }
        const bloomFilter = BloomFilter.create(1e7, 1e-5)
        return {
            isInBloomFilter: str => bloomFilter.contains(str),
            addToBloomFilter: str => bloomFilter.insert(str),
        }
    })()

    await asyncMap(
        commitFiles.filter(isGzJson),
        1,    // do not run parallel fetch
        async filename => {
            const { commit, repo } = await readGzJson(join(commitDir, filename))

            // skip large diff (likely to be a huge merge)
            if (commit.stats.total > LARGE_DIFF_LIMIT) return

            // skip commits without files of interest
            if (!hasInterestingFiles(commit.files)) return

            try {
                // candicate files (those modified by patch, ignore add / delete)
                const sources = commit.files
                    .filter(file => file.status === 'modified')
                    .filter(file => !isInBloomFilter(file.sha))

                for (const f of sources) {
                    addToBloomFilter(f.sha)

                    const extensionSignature = extname(f.filename).slice(1).toLowerCase()
                    if (!Extraction[extensionSignature]) continue

                    const {
                        extractFunctionFromHeaders,
                        extractFunctionPatchHeadings
                    } = Extraction[extensionSignature]

                    const parentSha = commit.parents[0].sha

                    // fetch file in parent and current commit
                    const vulneFileBuf = await urlFetch(`https://github.com/${repo.full_name}/raw/${parentSha}/${f.filename}`)
                    const fixedFileBuf = await urlFetch(`https://github.com/${repo.full_name}/raw/${commit.sha}/${f.filename}`)

                    const pairs = await extractFunctionFromHeaders(vulneFileBuf, fixedFileBuf, extractFunctionPatchHeadings(f.patch))

                    // write extracted objects to file
                    for (const {name, before, after} of pairs) {
                        console.log(`Extracted\t${repo.full_name} ${commit.sha} ${name}`)
                        await fs.writeFile(
                            join(OUTPUT_DIR, `${name}__${commit.sha}__vulne.${extensionSignature}`),
                            before
                        )
                        await fs.writeFile(
                            join(OUTPUT_DIR, `${name}__${commit.sha}__fixed.${extensionSignature}`),
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
