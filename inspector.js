const Koa = require('koa')
const KoaViews = require('koa-views')
const KoaStatic = require('koa-static')
const KoaRouter = require('koa-router')
const bytes = require('bytes')
const asyncMap = require('./lib/async-map')
const fs = require('fs').promises
const { readGzJson, isGzJson } = require('./lib/read-gz')
const { join, resolve, basename } = require('path')
const BloomFilter = require('bloom-filter')

// statistic variables
let perLanguage = {}
let uniqPerLanguage = {}
let uniqPerYear = {}
let uniqDelta = []
const bloomFilter = BloomFilter.create(1e7, 1e-5)

// read commits in <dataDir> into memory for fast processing
// -> Promise( function -> [commitJson] )
//
// print statistics to stdout
async function buildCommitCache(dataDir) {
    console.log('Please wait, building commit cache...')
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    let done = 0

    const commits = await asyncMap(
        commitFiles.filter(isGzJson),
        64,
        async filename => {
            const { commit, repo } = await readGzJson(join(commitDir, filename))

            if (++done % 500 === 0) console.log(`Commit cache progress: ${done} / ${commitFiles.length}, rss: ${bytes(process.memoryUsage().rss)}`)

            // calculate statistics
            const language = repo.language
            const authorDate = new Date(commit.commit.author.date)
            const message =commit.commit.message
            const year = authorDate.getFullYear()

            // commit signature is a join of changed file's hashes
            const commitSignature = commit.files.map(f => f.sha).join(',')

            perLanguage[language] = perLanguage[language] + 1 || 1

            // remove duplicates based on commit signature
            if (!bloomFilter.contains(commitSignature)) {
                bloomFilter.insert(commitSignature)
                uniqPerLanguage[language] = uniqPerLanguage[language] + 1 || 1
                uniqPerYear[year] = uniqPerYear[year] + 1 || 1
                uniqDelta.push(Math.max(commit.stats.additions, commit.stats.deletions))
            }

            return {
                sha: commit.sha,
                repo: repo.full_name,
                language: language,
                stars: repo.stargazers_count,
                githubUrl: commit.html_url,
                title: message.split('\n')[0],
                time: authorDate.getTime(),
                files: commit.files.length,
                additions: commit.stats.additions,
                deletions: commit.stats.deletions,
            }
        },
    )
    console.log(`Commit cache built, rss: ${bytes(process.memoryUsage().rss)}`)

    // write statistics to file
    await fs.writeFile(join(dataDir, 'stat-language.json'), JSON.stringify(perLanguage, null, '  '))
    await fs.writeFile(join(dataDir, 'stat-u-language.json'), JSON.stringify(uniqPerLanguage, null, '  '))
    await fs.writeFile(join(dataDir, 'stat-u-year.json'), JSON.stringify(uniqPerYear, null, '  '))
    await fs.writeFile(join(dataDir, 'stat-u-delta.txt'), uniqDelta.join('\n'))
    console.log(`Statistics written to ${dataDir}`)

    return () => commits
}

// start up a Web UI playgroud to view and experiment with collected commits
// default port is 8091, accessible via http://localhost:8091/
module.exports = function ghdcDataInspect(opts) {
    const dataDir = opts.dataDir

    // build commit cache
    let getCommits = null
    buildCommitCache(dataDir).then(getCommitsFn => getCommits = getCommitsFn)

    // set up Web UI
    const app = new Koa()
    const route = new KoaRouter()

    // serve static resources (CSS, JS)
    app.use(KoaStatic(resolve(__dirname, './inspector/'), { defer: false }))

    // set up template engine
    route.use(KoaViews(resolve(__dirname, './inspector/template/'), {
        map: {
          html: 'ejs'
        }
    }))

    // index, supports filter and sort
    route.get('/', async ctx => {
        const {
            filter = 'return true',
            sort = 'return 0'
        } = ctx.query

        const randomGenerator = require('random-seed').create();
        randomGenerator.seed(opts.seed)

        const filterFn = new Function('commit', 'random', filter)
        const sortFn = new Function('a', 'b', sort)

        const isReady = getCommits !== null
        const list = isReady && getCommits()
            .filter($ => filterFn($, () => randomGenerator.random()))
            .sort((a, b) => sortFn(a,b))

        await ctx.render('index', {
            dataDir: basename(dataDir),
            query: { filter, sort },
            isReady,
            list,
        })
    })

    // start Web server
    app.use(route.routes())
    app.listen(opts.port)
    console.log(`Server started at :${opts.port}`)
}