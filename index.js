const shortid = require('shortid')
const persistence = require('./lib/persistence')
const {
    GithubApiFetcher,
    GithubResourceFetcher
} = require('./lib/gh-fetch')
const winston = require('winston')
const mkdirp = require('mkdirp').sync
const { writeFile } = require('fs')
const { dirname, join } = require('path')
const { homedir } = require('os')

module.exports = async function ghdc_vuln(opts) {
    const OUTPUT_DIR = opts.outputDir.replace(/^~/, homedir())
    winston.level = opts.verbose ? 'verbose' : 'info'

    let taskState = persistence.restoreTaskState(opts.name, {
        name: opts.name || shortid(),
        query: opts.query_term,
        currentPage: 1,
        currentCommit: null,
    })

    function signalHandler() {
        persistence.persistTaskState(taskState.name, taskState)
        process.exit(0)
    }

    process.on('SIGINT', signalHandler)
    process.on('SIGTERM', signalHandler)

    const apiAgent = new GithubApiFetcher({
        name: 'api',
        loadFactor: opts.loadFactorApi,
        token: opts.token
    })

    const searchAgent = new GithubApiFetcher({
        name: 'search',
        loadFactor: opts.loadFactorSearch,
        accept: 'application/vnd.github.cloak-preview',
        token: opts.token
    })

    const resourceAgent = new GithubResourceFetcher({
        name: 'all',
        delay: 1
    })

    while (true) {
        const taskPath = join(OUTPUT_DIR, taskState.name)
        const commitDataPath = join(taskPath, 'commits')
        const sourceDataPath = join(taskPath, 'sources')
        mkdirp(taskPath)
        mkdirp(commitDataPath)
        mkdirp(sourceDataPath)

        const searchResult = await searchAgent.request(
            'https://api.github.com/search/commits', {
                q: taskState.query,
                page: taskState.currentPage,
                per_page: 100
            }
        )

        for (const item of searchResult.items) {
            const repoPath = item.repository.full_name
            const sha = item.sha
            const commitPathSuffix = join(repoPath, sha)

            const commit = await apiAgent.request(`https://api.github.com/repos/${repoPath}/commits/${sha}`)

            const commitJsonPath = join(commitDataPath, `${commitPathSuffix.replace(/\//g, '__')}.json`)
            mkdirp(dirname(commitJsonPath))
            writeFile(commitJsonPath, JSON.stringify(commit, null, '  '), _ => null)

            for (const file of commit.files) {
                await resourceAgent.request(file.raw_url).then(
                    rawFile => {
                        const filePath = join(sourceDataPath, commitPathSuffix, file.filename)
                        mkdirp(dirname(filePath))
                        writeFile(filePath, rawFile, _ => null)
                    },
                    error => null    // ignore error during resource download
                )

            }
        }

        taskState.currentPage += 1
    }
}