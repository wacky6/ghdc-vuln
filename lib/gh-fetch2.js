const axios = require('axios')
const winston = require('winston')
const shortid = require('shortid')
const EventEmitter = require('events')

const DEFERRAL_DELAY = 3 * 1000

const API_DEFAULT_DELAY = 10 * 1000
const API_AGREESIVE_DELAY = 60 * 1000

const RESOURCE_DEFAULT_DELAY = 1
const RESOURCE_AGREESIVE_DELAY = 10 * 1000

function figureOutRequestDelay(headers) {
    if (!headers) return API_AGREESIVE_DELAY
    if (!headers['date'] || !headers['x-ratelimit-remaining'] || !headers['x-ratelimit-reset']) return API_DEFAULT_DELAY

    const githubServerTime = new Date(headers['date']).getTime()
    const rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10)
    const rateLimitResetAt = new Date(parseInt(headers['x-ratelimit-reset'], 10) * 1000).getTime()

    return Math.round((rateLimitResetAt - githubServerTime) / Math.max(rateLimitRemaining, 1))
}

function verboseRateLimitHeader(name, headers) {
    if (headers && headers['x-ratelimit-remaining'] && headers['x-ratelimit-reset']) {
        winston.verbose(`rate-limit(${name}): remaining ${headers['x-ratelimit-remaining']}, reset at ${headers['x-ratelimit-reset']}`)
    }
}

class BaseFetcher extends EventEmitter {
    constructor(name = shortid()) {
        super()
        this._name = name
        this._queue = []
        this._maxRetry = 3
        this._runRequestImmediately = true
        this._pendingRequests = 0
        this._finished = 0
        this._shouldScheduleRequest = () => true
    }

    getNumberOfTasks() {
        return this._queue.length + this._pendingRequests
    }

    getNumberOfFinishedTasks() {
        return this._finished
    }

    setRequestPrecondition(fn) {
        this._shouldScheduleRequest = typeof fn === 'function' ? fn : () => fn
    }

    queue(requestOpts, callbackData, trial = 0) {
        this._queue.push({ trial, requestOpts, callbackData })
        this._schedule()
    }

    _schedule() {
        if (this._runRequestImmediately) {
            this._runRequest()
            this._runRequestImmediately = false
        } else {
            ;    // nop(), if _runRequestImmediately is not set, there will be a timeout
        }
    }

    _runRequest() {
        const {
            requestOpts,
            callbackData
        } = this._queue.shift()

        this._finished += 1

        // a convenient mock for testing
        this.emit('response', requestOpts._response && requestOpts._response.data || null, callbackData, requestOpts._response)

        setTimeout(_ => this._runRequest(), 1)
    }
}

class GithubApiFetcher extends BaseFetcher {
    constructor(name = shortid()) {
        super(name)
    }

    _runRequest() {
        if (this._queue.length === 0) {
            this._runRequestImmediately = true
            return Promise.resolve(null)
        }

        if (!this._shouldScheduleRequest()) {
            setTimeout(_ => this._runRequest(), DEFERRAL_DELAY)
            winston.verbose(`gh-api(${this._name}): deferring next request`)
            return Promise.resolve(null)
        }

        const {
            trial,
            requestOpts,
            callbackData,
        } = this._queue.shift()

        winston.verbose(`gh-api(${this._name}): making request: ${ requestOpts.url }`)

        this._pendingRequests += 1

        return axios({
            ...requestOpts,
            headers: {
                'User-Agent': `ANU-Vulerable-Code-Collection/v2 (+u6472740@anu.edu.au)`,
                ...(requestOpts.headers || {})
            },
            responseType: 'json',
            validateStatus: status => status >= 200 && status < 300,
        }).then(
            response => {
                winston.verbose(`gh-api(${this._name}): ${response.status} ${requestOpts.url}`)
                this._finished += 1
                this.emit('response', response.data, callbackData, response)
                return response.headers
            },
            error => {
                this.emit('request-error', error)

                // serious error, http request was not sent, back-off agreesively
                if (!error.response) {
                    winston.warn(`gh-api(${this._name}): retry count exceeded, ${ JSON.stringify(requestOpts) }`)
                    this.queue(requestOpts, callbackData, trial)
                    return null
                }

                // http error, retry this request later
                if (trial === this._maxRetry) {
                    // give up this request, log the failed request
                    winston.warn(`gh-api(${this._name}): retry count exceeded, ${ JSON.stringify(requestOpts) }`)
                } else {
                    winston.warn(`gh-api(${this._name}): ${error.response.status}, ${requestOpts.url}, requeue }`)
                    this.queue(requestOpts, callbackData, trial + 1)
                }
                return error.response.headers
            }
        ).then(headers => {
            verboseRateLimitHeader(this._name, headers)
            this._pendingRequests -= 1
            setTimeout(_ => this._runRequest(), figureOutRequestDelay(headers))
        })
    }
}

class GithubResourceFetcher extends BaseFetcher {
    constructor(name = shortid()) {
        super(name)
    }

    _runRequest() {
        if (this._queue.length === 0) {
            this._runRequestImmediately = true
            return
        }

        if (!this._shouldScheduleRequest()) {
            setTimeout(_ => this._runRequest(), DEFERRAL_DELAY)
            winston.verbose(`gh-api(${this._name}): deferring next request`)
            return Promise.resolve(null)
        }

        const {
            trial,
            requestOpts,
            callbackData
        } = this._queue.shift()

        winston.verbose(`gh-res(${this._name}): making request: ${ requestOpts.url }`)

        this._pendingRequests += 1

        return axios({
            ...requestOpts,
            headers: {
                'User-Agent': `ANU-Vulerable-Code-Collection/v2 (+u6472740@anu.edu.au)`,
                ...(requestOpts.headers || {})
            },
            responseType: 'blob',
            validateStatus: status => status >= 200 && status < 300,
        }).then(
            response => {
                winston.verbose(`gh-res(${this._name}): ${response.status} ${requestOpts.url}`)
                this._finished += 1
                this.emit('response', response.data, callbackData, response)
                return true
            },
            error => {
                this.emit('request-error', error)

                // serious error, http request was not sent, back-off agreesively
                if (!error.response) {
                    winston.warn(`gh-res(${this._name}): retry count exceeded, ${ JSON.stringify(requestOpts) }`)
                    this.queue(requestOpts, callbackData, trial)
                    return false
                }

                // http error, retry this request later
                if (trial === this._maxRetry) {
                    // give up this request, log the failed request
                    winston.warn(`gh-res(${this._name}): retry count exceeded, ${ JSON.stringify(requestOpts) }`)
                } else {
                    winston.warn(`gh-res(${this._name}): ${error.response.status}, ${requestOpts.url} }`)
                    this.queue(requestOpts, callbackData, trial + 1)
                }
                return false
            }
        ).then(responseSuccess => {
            this._pendingRequests -= 1
            setTimeout(_ => this._runRequest(), responseSuccess ? RESOURCE_DEFAULT_DELAY : RESOURCE_AGREESIVE_DELAY)
        })
    }
}

module.exports = {
    figureOutRequestDelay,
    GithubApiFetcher,
    GithubResourceFetcher
}