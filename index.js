const shortid = require('shortid')
const {
    GithubApiFetcher,
    GithubResourceFetcher
} = require('./lib/gh-fetch2')
const winston = require('winston')
const mkdirp = require('mkdirp').sync
const { writeFile: _writeFile, createWriteStream } = require('fs')
const { dirname, join } = require('path')
const { homedir } = require('os')
const { generateQueryDateRange } = require('./lib/date-range')
const qs = require('querystring')
const bytes = require('bytes')
const zlib = require('zlib')
const BloomFilter = require('bloom-filter')

const COMMIT_SIZE_UPPERBOUND_TO_FETCH = 10

function createWriteFileFn(compression = null) {
    if (compression) {
        return (filepath, data, cbk) => {
            const buffer = typeof data === 'string' ? Buffer.from(data) : data
            zlib.gzip(buffer, (err, gzBuffer) => _writeFile(filepath + '.gz', gzBuffer, cbk))
        }
    } else {
        return _writeFile
    }
}

module.exports = function ghdc_vuln(opts) {
    opts.name = opts.name || shortid()

    const OUTPUT_DIR = opts.outputDir.replace(/^~/, homedir())
    winston.level = opts.verbose ? 'verbose' : 'info'

    const writeFile = createWriteFileFn(opts.gzip)

    const searchFetcher = new GithubApiFetcher(opts.name + '-search')
    const commitFetcher = new GithubApiFetcher(opts.name + '-commit')
    const repoFetcher = new GithubApiFetcher(opts.name + '-repo')
    const resourceFetcher = new GithubResourceFetcher(opts.name)

    // prevent queue build up, which could blow up server memory
    searchFetcher.setRequestPrecondition(_ => commitFetcher.getStat().nPending < 50 && repoFetcher.getStat().nPending < 50)
    commitFetcher.setRequestPrecondition(_ => resourceFetcher.getStat().nPending < 100)
    repoFetcher.setRequestPrecondition(_ => resourceFetcher.getStat().nPending < 100)

    const taskPath = join(OUTPUT_DIR, opts.name)
    const commitDataPath = join(taskPath, 'commits')
    const sourceDataPath = join(taskPath, 'sources')
    mkdirp(taskPath)
    mkdirp(commitDataPath)
    mkdirp(sourceDataPath)

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
        const bloomFilterLog = createWriteStream(join(taskPath, 'incompetent-ape-list.txt'))
        return {
            isInBloomFilter: sha => bloomFilter.contains(Buffer.from(sha, 'hex')),
            addToBloomFilter: sha => bloomFilter.insert(Buffer.from(sha, 'hex')),
            writeToBloomFilterLog: msg => bloomFilterLog.write(`${msg}\n`)
        }
    })()

    const requestAuth = opts.token ? { auth: { username: opts.token, password: '' } } : {}

    function printStatistic() {
        const {
            nPending: sp,
            nFinished: sf,
            nError: se,
        } = searchFetcher.getStat()
        const {
            nPending: cp,
            nFinished: cf,
            nError: ce,
        } = commitFetcher.getStat()
        const {
            nPending: pp,
            nFinished: pf,
            nError: pe,
        } = repoFetcher.getStat()
        const {
            nPending: rp,
            nFinished: rf,
            nError: re,
        } = resourceFetcher.getStat()
        const rss = process.memoryUsage().rss

        winston.info(`stat: sr=${sp}/${sf}:${se}, cm=${cp}/${cf}:${ce}, rp=${pp}/${pf}:${pe}, rc=${rp}/${rf}:${re}, rss=${bytes(rss)}`)
    }

    setInterval(printStatistic, 30 * 1000).unref()

    searchFetcher.on('response', (searchResult, { requestOpts }, resp) => {
        winston.verbose(`ghdc: search ${requestOpts._query}, returned ${searchResult.items.length} items`)
        for (const item of searchResult.items) {
            if (isInBloomFilter(item.sha)) {
                // caught an incompetent ape, write it down
                // do not queue this commit (because it has been fetched by another request)
                writeToBloomFilterLog(`${item.sha}\t${item.repository.full_name}`)
                continue
            }
            addToBloomFilter(item.sha)
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
                const nextRequestOpts = { ...restOpts, url: nextLink }
                searchFetcher.queue(nextRequestOpts, { requestOpts: nextRequestOpts })
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
                if (file.raw_url) {
                    resourceFetcher.queue({
                        method: 'GET',
                        url: file.raw_url
                    }, { repo, commit, file })
                }
            }
            winston.verbose(`ghdc: fetched ${repo.full_name}/${commit.sha}, ${commit.files.length} files queued`)
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
            winston.verbose(`ghdc: fetched ${repo.full_name}/${commit.sha}, ${commit.files.length} files, manifest written`)
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