/*
 * repository fetcher with cache
 *
 * Cache is to reduce network load thus improve performance
 * when investigating the same repository over time. Such as
 * FFmpeg or Linux's buffer overflow.
 */

const { join } = require('path')
const { clone } = require('./git-call')
const fs = require('fs').promises
const mkdirp = require('mkdirp').sync

// list of caches being built
const buildingCache = {}

module.exports = {
    /*
     * cloneUrl: repository's clone string (can be local file path)
     * fullName: repository's full name, as cache key
     * dest: destination directory (usually a tmpdir)
     * cacheDir: repository cache directory
     *
     * -> Promise, when resolved, indicate the repository is fetched
     */
    async fetchRepositoryTo(cloneUrl, fullName, dest, cacheDir = '/ghdc-repo-cache/') {
        if (cacheDir) {
            const cachedRepoDir = join(cacheDir, fullName)
            const cacheRepoExists = await fs.access(cachedRepoDir).then(_ => true, _ => false)

            if (!cacheRepoExists && !buildingCache[fullName]) {
                // not in cache, not building, fetch to cache dir
                mkdirp(cachedRepoDir)
                // console.log(`${fullName} cache miss`)
                buildingCache[fullName] = clone(cloneUrl, cachedRepoDir, '/tmp')
                await buildingCache[fullName]
                delete buildingCache[fullName]
                console.log(`${fullName} cache built`)
            } else {
                if (buildingCache[fullName]) {
                    console.log(`${fullName} waiting for cache completion`)
                    await buildingCache[fullName]
                    console.log(`${fullName} cache built, resume`)
                } else {
                    // console.log(`${fullName} cache hit`)
                }
            }

            // clone cache to working dir
            await clone(cachedRepoDir, dest, '/tmp')
        } else {
            await clone(cloneUrl, dest, '/tmp')
        }
    }
}