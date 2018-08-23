const shortid = require('shortid')
const persistence = require('./lib/persistence')
const {
    GithubApiFetcher,
    GithubResourceFetcher
} = require('./lib/gh-fetch2')
const winston = require('winston')
const mkdirp = require('mkdirp').sync
const { writeFile } = require('fs')
const { dirname, join } = require('path')
const { homedir } = require('os')
const { generateQueryDateRange } = require('./lib/date-range')
const qs = require('querystring')

const COMMIT_SIZE_UPPERBOUND_TO_FETCH = 10

module.exports = function ghdc_vuln(opts) {
    opts.name = opts.name || shortid()

    const OUTPUT_DIR = opts.outputDir.replace(/^~/, homedir())
    winston.level = opts.verbose ? 'verbose' : 'info'

    const searchFetcher = new GithubApiFetcher(opts.name + '-search')
    const commitFetcher = new GithubApiFetcher(opts.name + '-commit')
    const repoFetcher = new GithubApiFetcher(opts.name + '-repo')
    const resourceFetcher = new GithubResourceFetcher(opts.name)

    searchFetcher.setRequestPrecondition(_ => commitFetcher.getNumberOfTasks() < 50 && repoFetcher.getNumberOfTasks() < 50)
    commitFetcher.setRequestPrecondition(_ => resourceFetcher.getNumberOfTasks() < 100)
    repoFetcher.setRequestPrecondition(_ => resourceFetcher.getNumberOfTasks() < 100)

    const taskPath = join(OUTPUT_DIR, opts.name)
    const commitDataPath = join(taskPath, 'commits')
    const sourceDataPath = join(taskPath, 'sources')
    mkdirp(taskPath)
    mkdirp(commitDataPath)
    mkdirp(sourceDataPath)

    const requestAuth = opts.token ? { auth: { username: opts.token, password: '' } } : {}

    setInterval(_ => {
        console.log(`queue: sr=${searchFetcher.getNumberOfTasks()}, cm=${commitFetcher.getNumberOfTasks()}, rp=${repoFetcher.getNumberOfTasks()}, rc=${resourceFetcher.getNumberOfTasks()}`)
    }, 60 * 1000)

    searchFetcher.on('response', (searchResult, { requestOpts }, resp) => {
        winston.info(`ghdc: search ${requestOpts._query}, returned ${searchResult.items.length} items`)
        for (const item of searchResult.items) {
            commitFetcher.queue({
                method: 'GET',
                url: item.url,
                ...requestAuth
            })
        }

        if (resp.headers['link']) {
            // append next page if github header says there are more
            const link = resp.headers['link']
            const posRelNext = link.indexOf('rel="next"')
            if (posRelNext >= 0) {
                const nextLink = link.slice(0, posRelNext).trim().slice(1, -2)
                const { query: _ignored, ...restOpts } = requestOpts
                searchFetcher.queue({ ...restOpts, url: nextLink })
                winston.verbose(`ghdc: queue next page: ${nextLink}`)
            }
        }
    })

    commitFetcher.on('response', (commit) => {
        repoFetcher.queue({
            method: 'GET',
            url: commit.commit.url.replace(/\/git\/commits\/.*$/g, ''),
            ...requestAuth
        }, { commit })
    })

    repoFetcher.on('response', (repo, { commit }) => {
        const commitPrefix = repo.full_name + '/' + commit.sha
        const commitJsonPath = join(commitDataPath, `${commitPrefix.replace(/\//g, '__')}.json`)
        mkdirp(dirname(commitJsonPath))
        writeFile(commitJsonPath, JSON.stringify({ commit, repo }, null, '  '), _ => null)

        // if commit changes are small (less than <some> files), fetch them
        if (commit.files.length < COMMIT_SIZE_UPPERBOUND_TO_FETCH) {
            for (const file of commit.files) {
                resourceFetcher.queue({
                    method: 'GET',
                    url: file.raw_url
                }, { repo, commit, file })
            }
            winston.info(`ghdc: fetched ${repo.full_name}/${commit.sha}, ${commit.files.length} files queued`)
        } else {
            // write a manifest
            const manifestPath = join(sourceDataPath, '__ghdc_manifest.json')
            const manifest = commit.files.map(file => ({
                sha: file.sha,
                filename: file.filename,
                status: file.status,
                additions: file.additions,
                deletions: file.deletions,
                changes: file.changes,
                raw_url: file.raw_url,
                blob_url: file.blob_url,
            }))
            mkdirp(dirname(manifestPath))
            writeFile(manifestPath, JSON.stringify(manifest, null, '  '), _ => null)
            winston.info(`ghdc: fetched ${repo.full_name}/${commit.sha}, ${commit.files.length} files, manifest written`)
        }
    })

    resourceFetcher.on('response', (buffer, {repo, commit, file}) => {
        const filePath = join(sourceDataPath, repo.full_name, commit.sha, file.filename)
        mkdirp(dirname(filePath))
        writeFile(filePath, buffer, _ => null)
    })

    // schedule tasks
    for (const dateRange of [...generateQueryDateRange(...opts.dateRange)].reverse()) {
        const query = `committer-date:${dateRange} ${opts.query_term}`
        const requestOpts = {
            method: 'GET',
            url: 'https://api.github.com/search/commits?' + qs.stringify({
                q: query,
                per_page: 100,
                page: 1
            }),
            _query: query,
            headers: {
                'Accept': 'application/vnd.github.cloak-preview'
            },
            ...requestAuth
        }
        searchFetcher.queue(requestOpts, { requestOpts })
    }
}