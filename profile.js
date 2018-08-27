const fs = require('fs').promises
const { join, extname } = require('path')
const async = require('async')

function asyncMap(coll, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(coll, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

function round2(n) {
    return Math.round(n * 100) / 100
}

module.exports = async function ghdcDataProfile(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')

    const commitFiles = await fs.readdir(commitDir)
    const sha = new Set()
    const lang = {}
    const langDedupe = {}

    // NOTE: do not read all files into memory. Memory may be insufficient
    //       do stream processing
    console.log('repo,stars,forks,issues,lang,n_files,addition,deletion,sha')
    await asyncMap(
        commitFiles.filter(filename => extname(filename) === '.json'),
        64,
        async filename => {
            const {
                commit,
                repo
            } = await fs.readFile(join(commitDir, filename), { encoding: 'utf-8' }).then(str => JSON.parse(str))

            lang[repo.language] = (lang[repo.language] || 0) + 1

            if (sha.has(commit.sha)) return
            sha.add(commit.sha)

            langDedupe[repo.language] = (langDedupe[repo.language] || 0) + 1

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

    console.error(`distinct commits: ${ sha.size } / ${ commitFiles.length }, ${ round2(sha.size / commitFiles.length * 100) }%`)
    console.error('per language: <deduped> / <raw>')
    for (const key in lang) {
        if (lang[key] > 100) {
            console.error(`\t${key}: ${langDedupe[key]} / ${lang[key]}, ${ round2(langDedupe[key] / lang[key] * 100) }%`)
        }
    }

}