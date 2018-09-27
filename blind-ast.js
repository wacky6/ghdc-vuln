const { execFile: _execFile } = require('child_process')
const promisify = require('util').promisify
const execFile = promisify(_execFile)

const fs = require('fs').promises
const { join, extname, resolve, basename } = require('path')
const async = require('async')
const mkdirp = require('mkdirp').sync
const rimraf = promisify(require('rimraf'))

const { readGzFile } = require('./inspector')

const COMMIT_FILTER = (commit, repo) =>
    repo.language === 'C'
    && commit.files.length > 0
    && commit.stats.additions <= 20
    && commit.files.find(file => extname(file.filename).toLowerCase() === '.c')

function asyncMap(coll, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(coll, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

function generateAst(filepath) {
    return execFile('clang', [
        '-cc1',
        '-ast-dump',
        filepath
    ], { maxBuffer: 128 * 1024 * 1024 }).then(
        ret => ret,    // { stdout, stderr }
        error => ({ error, stdout: error.stdout, stderr: error.stderr })
    )
}

function flattenFilename(filename) {
    return filename.replace(/\//g, '__')
}

module.exports = async function(opts) {
    const dataDir = opts.dataDir
    const commitDir = join(dataDir, 'commits')
    const commitFiles = await fs.readdir(commitDir)

    const BASE_OUTPUT_DIR = resolve(process.cwd(), opts.outputDir)

    await asyncMap(
        commitFiles,
        require('os').cpus().length,
        async filename => {
            const {
                commit,
                repo
            } = await readGzFile(join(commitDir, filename), 'utf-8').then(str => JSON.parse(str))

            console.log(`-------- working on ${repo.full_name}`)

            if (!COMMIT_FILTER(commit, repo)) {
                console.log('skip: ${repo.full_name} ${commit.sha}')
                return null
            }

            const COMMIT_DIR = repo.full_name.replace(/\//g, '__') + '__' + commit.sha
            const OUTPUT_DIR = join(BASE_OUTPUT_DIR, COMMIT_DIR)
            mkdirp(OUTPUT_DIR)

            process.chdir('/tmp')

            await rimraf('/tmp/sample')
            await execFile('git', [
                'clone',
                repo.clone_url,
                'sample'
            ], { maxBuffer: 128 * 1024 * 1024 })

            process.chdir('/tmp/sample')

            const sources = commit.files.filter(file =>
                extname(file.filename).toLowerCase() === '.c'
                && file.status === 'modified'
            )

            // compile vuln version
            await execFile('git', [
                'checkout',
                '-f',
                commit.parents[0].sha
            ])
            console.log('-------- compiling parent')

            for (const f of sources) {
                const {
                    error,
                    stdout,
                    stderr
                } = await generateAst(f.filename)

                console.log(stderr)

                if (stderr.length > 0) {
                    await fs.writeFile(
                        join(OUTPUT_DIR, 'vuln_' + flattenFilename(f.filename) + '.stderr.txt'),
                        stderr
                    )
                }
                if (stdout.length > 0) {
                    await fs.writeFile(
                        join(OUTPUT_DIR, 'vuln_' + flattenFilename(f.filename) + '.ast.txt'),
                        stdout
                    )
                }
            }

            // compile fixed version
            await execFile('git', [
                'checkout',
                '-f',
                commit.sha
            ])

            console.log('-------- compiling current commit')

            for (const f of sources) {
                const {
                    error,
                    stdout,
                    stderr
                } = await generateAst(f.filename)

                console.log(stderr)

                if (stderr.length > 0) {
                    await fs.writeFile(
                        join(OUTPUT_DIR, 'fixed_' + flattenFilename(f.filename) + '.stderr.txt'),
                        stderr
                    )
                }

                if (stdout.length > 0) {
                    await fs.writeFile(
                        join(OUTPUT_DIR, 'fixed_' + flattenFilename(f.filename) + '.ast.txt'),
                        stdout
                    )
                }
            }

            process.chdir('/tmp')
        }
    )
}
