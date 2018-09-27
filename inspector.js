const Koa = require('koa')
const KoaViews = require('koa-views')
const KoaStatic = require('koa-static')
const KoaRouter = require('koa-router')
const zlib = require('zlib')
const promisify = require('util').promisify
const gunzip = promisify(zlib.gunzip)
const bytes = require('bytes')

const fs = require('fs').promises
const { join, extname, resolve, basename } = require('path')
const async = require('async')

function asyncMap(coll, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(coll, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

function unpackBuffer(encoding) {
    return encoding ? buf => buf.toString(encoding) : buf => buf
}

async function readGzFile(filename, encoding = null) {
    if (extname(filename).toLocaleLowerCase() === '.gz') {
        return fs.readFile(filename, {encoding: null}).then(gunzip).then(unpackBuffer(encoding))
    } else {
        return fs.readFile(filename, {encoding})
    }
}

// resolve to getter function that returns a list of commits
async function buildCommitCache(dataDir) {
    console.log('Please wait, building commit cache...')
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    let done = 0

    const commits = await asyncMap(
        commitFiles,
        64,
        async filename => {
            const {
                commit,
                repo
            } = await readGzFile(join(commitDir, filename), 'utf-8').then(str => JSON.parse(str))

            if (++done % 500 === 0) console.log(`Commit cache progress: ${done} / ${commitFiles.length}, rss: ${bytes(process.memoryUsage().rss)}`)

            return {
                sha: commit.sha,
                repo: repo.full_name,
                language: repo.language,
                stars: repo.stargazers_count,
                githubUrl: commit.html_url,
                title: commit.commit.message.split('\n')[0],
                time: new Date(commit.commit.committer.date).getTime(),
                files: commit.files.length,
                additions: commit.stats.additions,
                deletions: commit.stats.deletions,
            }
        },
    )
    console.log(`Commit cache built, rss: ${bytes(process.memoryUsage().rss)}`)
    return () => commits
}

module.exports = function(opts) {
    const dataDir = opts.dataDir

    let getCommits = null

    // build commit cache in background
    buildCommitCache(dataDir).then(getCommitsFn => getCommits = getCommitsFn)

    const app = new Koa()
    const route = new KoaRouter()

    app.use(KoaStatic(resolve(__dirname, './inspector/'), { defer: false }))

    route.use(KoaViews(resolve(__dirname, './inspector/template/'), {
        map: {
          html: 'ejs'
        }
    }))

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
            dataDir: basename(opts.dataDir),
            query: ctx.query,
            isReady,
            list,
        })
    })

    route.get('/commits/:commit/', async ctx => {
        console.log(ctx.query)
        console.log(ctx.params)
        // TODO:
    })

    app.use(route.routes())
    app.listen(opts.port)
    console.log(`Server started at :${opts.port}`)
}

module.exports.readGzFile = readGzFile