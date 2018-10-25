/* GitHub fetcher 2
 *
 * Use GithubApiFetcher for API calls
 * Use GithubResourceFetcher for resource / file requests
 *
 * Unit test: ../test/gh-fetch2
 */
const axios = require('axios')
const winston = require('winston')
const shortid = require('shortid')
const EventEmitter = require('events')

const DEFERRAL_DELAY = 3 * 1000

const API_DEFAULT_DELAY = 10 * 1000
const API_AGREESIVE_DELAY = 60 * 1000

const RESOURCE_DEFAULT_DELAY = 1
const RESOURCE_AGREESIVE_DELAY = 10 * 1000

// calculate request delay from GitHub's rate limit response header
// -> Number (Integer)
//
// should spread out requests over the remaining time slice
function figureOutRequestDelay(headers) {
    // network failed, backoff
    if (!headers) return API_AGREESIVE_DELAY

    // GitHub server busy or use default
    if (!headers['date'] || !headers['x-ratelimit-remaining'] || !headers['x-ratelimit-reset']) return API_DEFAULT_DELAY

    const githubServerTime = new Date(headers['date']).getTime()
    const rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10)
    const rateLimitResetAt = new Date(parseInt(headers['x-ratelimit-reset'], 10) * 1000).getTime()

    return Math.round(
        (rateLimitResetAt - githubServerTime)
        /
        Math.max(rateLimitRemaining, 1)     // avoid division by zero
    )
}

// print rate-limit header for debugging
function verboseRateLimitHeader(name, headers) {
    if (headers && headers['x-ratelimit-remaining'] && headers['x-ratelimit-reset']) {
        winston.verbose(`rate-limit(${name}): remaining ${headers['x-ratelimit-remaining']}, reset at ${headers['x-ratelimit-reset']}`)
    }
}

/*
 * GitHub Fetcher Skeleton
 * Provides queue and statistic skeleton
 */
class BaseFetcher extends EventEmitter {
    // <name>: a user friendly name
    constructor(name = shortid()) {
        super()
        this._name = name
        this._queue = []
        this._maxRetry = 3
        this._runRequestImmediately = true
        this._pendingRequests = 0
        this._finished = 0
        this._erroredRequests = 0
        this._shouldScheduleRequest = () => true
    }

    // get statistics about fetcher's queue
    // -> [ numOfPendingTasks, numOfFinishedTasks, numOfErrors ]
    getStat() {
        return {
            nPending: this._queue.length + this._pendingRequests,
            nFinished: this._finished,
            nError: this._erroredRequests
        }
    }

    // set request precondition
    // useful for throttling and memory usage limit
    // <fn>: a function that returns a Boolean to indicate whether to start a new request
    setRequestPrecondition(fn) {
        this._shouldScheduleRequest = typeof fn === 'function' ? fn : () => fn
    }

    // add a new task
    // <requestOpts>:  axios's request options
    // <callbackData>: a custom object that will be passed to 'response' event
    //                 useful to attach request information, in order to form a continuous passing style (CPS)
    // <trial>:        number of retries for this request, default is 0
    queue(requestOpts, callbackData, trial = 0) {
        this._queue.push({ trial, requestOpts, callbackData })
        this._schedule()
    }

    // schedule next request
    _schedule() {
        if (this._runRequestImmediately) {
            this._runRequest()
            this._runRequestImmediately = false
        } else {
            ;    // nop(), if _runRequestImmediately is not set, there will be a timeout
        }
    }

    // perform request
    // updates queue statistics
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

/*
 * GitHub Fetcher for API calls
 *
 * Implements rate-limit according to best practice (https://developer.github.com/v3/rate_limit/)
 * With automatic backoff and retry during network failure
 */
class GithubApiFetcher extends BaseFetcher {
    constructor(name = shortid()) {
        super(name)
    }

    _runRequest() {
        // queue empty, next request can be run immediately
        if (this._queue.length === 0) {
            this._runRequestImmediately = true
            return Promise.resolve(null)
        }

        // check requestPrecondition throttling
        // if throttled, setup next request's timeout
        if (!this._shouldScheduleRequest()) {
            setTimeout(_ => this._runRequest(), DEFERRAL_DELAY)
            winston.verbose(`gh-api(${this._name}): deferring next request`)
            return Promise.resolve(null)
        }

        // get first task in queue
        const {
            trial,
            requestOpts,
            callbackData,
        } = this._queue.shift()

        winston.verbose(`gh-api(${this._name}): making request: ${ requestOpts.url }`)

        this._pendingRequests += 1

        // start request
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

                this._erroredRequests += 1

                // serious error, http request was not sent, back-off agreesively
                if (!error.response) {
                    winston.warn(`gh-api(${this._name}): non HTTP error: ${error.message}, ${requestOpts.url}`)
                } else {
                    winston.warn(`gh-api(${this._name}): ${error.response.status}, ${requestOpts.url} }`)
                }

                if (trial === this._maxRetry) {
                    // give up this request, log the failed request
                    winston.warn(`gh-api(${this._name}): retry count exceeded, ${ JSON.stringify(requestOpts) }`)
                } else {
                    // re-queue to the end
                    this.queue(requestOpts, callbackData, trial + 1)
                }

                return error.response && error.response.headers
            }
        ).then(headers => {
            // when request finishes, regardless of success/error
            // perform rate limit check
            verboseRateLimitHeader(this._name, headers)
            this._pendingRequests -= 1
            setTimeout(_ => this._runRequest(), figureOutRequestDelay(headers))
        })
    }
}

/*
 * GitHub Fetcher for Resource Requests
 *
 * Implements a default rate-limit
 * With automatic backoff and retry during network failure
 */
class GithubResourceFetcher extends BaseFetcher {
    constructor(name = shortid()) {
        super(name)
    }

    _runRequest() {
        // queue empty, next request can be run immediately
        if (this._queue.length === 0) {
            this._runRequestImmediately = true
            return
        }

        // check requestPrecondition throttling
        // if throttled, setup next request's timeout
        if (!this._shouldScheduleRequest()) {
            setTimeout(_ => this._runRequest(), DEFERRAL_DELAY)
            winston.verbose(`gh-api(${this._name}): deferring next request`)
            return Promise.resolve(null)
        }

        // get first task in queue
        const {
            trial,
            requestOpts,
            callbackData
        } = this._queue.shift()

        winston.verbose(`gh-res(${this._name}): making request: ${ requestOpts.url }`)

        this._pendingRequests += 1

        // run request
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

                this._erroredRequests += 1

                // serious error, http request was not sent, back-off agreesively
                if (!error.response) {
                    winston.warn(`gh-api(${this._name}): non HTTP error: ${error.message}, ${requestOpts.url}`)
                } else {
                    winston.warn(`gh-api(${this._name}): ${error.response.status}, ${requestOpts.url} }`)
                }

                if (trial === this._maxRetry) {
                    // give up this request, log the failed request
                    winston.warn(`gh-api(${this._name}): retry count exceeded, ${ JSON.stringify(requestOpts) }`)
                } else {
                    // re-queue to the end
                    this.queue(requestOpts, callbackData, trial + 1)
                }

                return false
            }
        ).then(responseSuccess => {
            // use default rate limit for typical requests
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