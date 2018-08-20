// github fetcher

const superagent = require('superagent')
const winston = require('winston')
const shortid = require('shortid')
const { readFileSync } = require('fs')
const { resolve } = require('path')

const VERSION = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), {encoding: 'utf-8'})).version
const USER_AGENT = `ANU-Vulerable-Code-Collection/${VERSION} (+u6472740@anu.edu.au)`

/* getAgent() always return a function that should be called to send reqeust
 *
 * Function args: sendRequest(url, query)
 */

class GithubApiFetcher {
    constructor({
        name = shortid(),
        token = '',
        accept = 'application/json',
        loadFactor = 1,    // factor to interpret remaining API call limit
    } = {}) {
        this._name = name
        this._token = token
        this._accept = accept
        this._loadFactor = loadFactor
        this._availableAgent = Promise.resolve(superagent)
    }

    // wait and return a superagent instance, when it is ok to make the next request
    request(url, query) {
        return this._availableAgent
            .then(agent => {
                // winston.verbose(`RateLimit-${this._name}: fetch ${url} / ${JSON.stringify(query)}`)
                let ret = agent
                    .get(url)
                    .query(query)
                    .accept(this._accept)
                    .redirects(3)
                    .timeout(10000)
                    .set('userAgent', USER_AGENT)

                if (this._token)
                    ret = ret.auth(this._token, '')

                return ret
            })
            .then(
                resp => {
                    const githubServerTime = new Date(resp.get('date')).getTime()
                    const rateLimitRemaining = parseInt(resp.get('x-ratelimit-remaining'), 10)
                    const rateLimitResetAt = new Date(parseInt(resp.get('x-ratelimit-reset'), 10) * 1000).getTime()

                    // our interpretation
                    const numberOfCallsRemaining = Math.floor(rateLimitRemaining * this._loadFactor) || 1
                    const numberOfMillisecondsToKill = Math.max((rateLimitResetAt - githubServerTime), 1000)
                    const delay = Math.round(numberOfMillisecondsToKill / numberOfCallsRemaining)

                    winston.verbose(`RateLimit-${this._name}: ${resp.status} - ${url}`)
                    winston.verbose(`RateLimit-${this._name}: ${rateLimitRemaining} remaining, reset at ${new Date(rateLimitResetAt).toISOString()}, delay = ${delay}ms`)

                    this._availableAgent = new Promise(resolve =>
                        setTimeout(_ => resolve(superagent), delay)
                    )

                    return resp.body
                },
                error => {
                    if (error.resp && error.resp.status >= 500) {
                        return new Promise(resolve => {
                            setTimeout(_ => resolve(this.request(url), 60*1000))
                        })
                    }
                    return Promise.reject(error)
                }
            )
    }
}

class GithubResourceFetcher {
    constructor({
        name = shortid(),
        delay = 100,    // number of ms before fetching next resource
    } = {}) {
        this._name = name
        this._delay = delay
        this._availableAgent = Promise.resolve(superagent)
    }

    // wait and return a superagent instance, when it is ok to make the next request
    request(url) {
        return this._availableAgent
            .then(agent => {
                // winston.verbose(`Resource-${this._name}: fetch ${url}`)
                return agent
                    .get(url)
                    .responseType('blob')
                    .timeout(10000)
            })
            .then(
                resp => {
                    winston.verbose(`Resource-${this._name}: ${resp.status} - ${url}`)

                    this._availableAgent = new Promise(resolve =>
                        setTimeout(_ => resolve(superagent), this._delay)
                    )

                    return resp.body
                },
                error => {
                    if (error.resp && error.resp.status >= 500) {
                        return new Promise(resolve => {
                            setTimeout(_ => resolve(this.request(url), 60*1000))
                        })
                    }
                    return Promise.reject(error)
                }
            )
    }
}

module.exports = {
    GithubApiFetcher,
    GithubResourceFetcher,
}