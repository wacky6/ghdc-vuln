const fs = require('fs').promises
const { join } = require('path')
const { isGzJson, readGzJson } = require('./lib/read-gz')
const asyncMap = require('./lib/async-map')

// round to 2 decimal point, useful for percentage
function round2(n) {
    return Math.round(n * 100) / 100
}

//
// read commit JSON, print extract fields as CSV
//
// print to stdout: extracted fields in CSV format
// print to stderr: statistics about duplicated repositories
//
module.exports = async function ghdcDataProfile(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')

    const commitFiles = await fs.readdir(commitDir)

    // statistic related variables
    let sha = new Set()
    let lang = {}
    let langDedupe = {}

    // NOTE: do not read all files into memory. Memory may be insufficient,
    //       do stream processing instead.

    // write CSV header
    console.log('repo,stars,forks,issues,lang,n_files,addition,deletion,sha')
    await asyncMap(
        commitFiles.filter(isGzJson),
        64,
        async filename => {
            const { commit, repo } = await readGzJson(join(commitDir, filename))

            // record language
            lang[repo.language] = (lang[repo.language] || 0) + 1

            // deduplicate, skip if commit is already seen
            if (sha.has(commit.sha)) return
            sha.add(commit.sha)

            // record language for unique commits
            langDedupe[repo.language] = (langDedupe[repo.language] || 0) + 1

            // build CSV record, should match with header
            const line = [
                repo.full_name,
                repo.stargazers_count,
                repo.forks_count,
                repo.open_issues,
                repo.language,
                commit.files.length,
                commit.stats.additions,
                commit.stats.deletions,
                commit.sha
            ]
            console.log(line.join(','))
        }
    )

    // print to stderr:
    // statistics about per language duplication
    // only care for languages with (>100) of duplicates
    console.error(`distinct commits: ${ sha.size } / ${ commitFiles.length }, ${ round2(sha.size / commitFiles.length * 100) }%`)
    console.error('per language: <deduped> / <raw>')
    for (const key in lang) {
        if (lang[key] > 100) {
            console.error(`\t${key}: ${langDedupe[key]} / ${lang[key]}, ${ round2(langDedupe[key] / lang[key] * 100) }%`)
        }
    }
}