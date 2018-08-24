const fs = require('fs').promises
const { join, extname } = require('path')
const async = require('async')

function asyncMap(coll, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(coll, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

module.exports = async function ghdcDataProfile(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')

    const commitFiles = await fs.readdir(commitDir)

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
            const line = [
                repo.full_name,
                repo.stargazers_count,
                repo.forks_count,
                repo.open_issues,
                repo.language,
                commit.files.length,
                commit.stats.addition,
                commit.stats.deletion,
                commit.sha
            ]
            console.log(line.join(','))
        }
    )
}