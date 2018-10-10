/*
 * url fetch with auto retry
 */

const axios = require('axios')
const winston = require('winston')

const RESOURCE_AGREESIVE_DELAY = 10 * 1000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = function fetch(url) {
    let retryCount = 0
    return axios({
        url,
        headers: {
            'User-Agent': `ANU-Vulerable-Code-Collection/v2 (+u6472740@anu.edu.au)`
        },
        responseType: 'blob',
        validateStatus: status => status >= 200 && status < 300
    }).then(
        response => response.data,
        error => {
            retryCount += 1
            winston.warn(`url-fetch: retry count exceeded, ${ url }, ${ error.message }`)
            if (retryCount < 3) {
                if (error.response && error.response.status !== 404) {
                    // back off if non 404
                    return sleep(RESOURCE_AGREESIVE_DELAY).then(_ => fetch(url))
                } else {
                    return fetch(url)
                }
            }
            return null
        }
    )
}
