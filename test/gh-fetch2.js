const test = require('tape')
const gh2 = require('../lib/gh-fetch2')

const DEFAULT_DELAY = 10 * 1000
const AGREESIVE_DELAY = 60 * 1000

test('figureOutRequestDelay', t => {
    t.equal(gh2.figureOutRequestDelay(null), AGREESIVE_DELAY, 'agressive delay')

    t.equal(gh2.figureOutRequestDelay({}), DEFAULT_DELAY, 'default delay if server returns non-sense')

    const NOW = Date.now() % 1000 * 1000

    t.equal(gh2.figureOutRequestDelay({
        'date': new Date(NOW).toISOString(),
        'x-ratelimit-remaining': '10',
        'x-ratelimit-reset': String(Math.floor((NOW + 3600 * 1000) / 1000))
    }), Math.round(3600 * 1000 / 10), 'spread out request')

    t.equal(gh2.figureOutRequestDelay({
        'date': new Date(NOW).toISOString(),
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(Math.floor((NOW + 3600 * 1000) / 1000))
    }), 3600 * 1000, 'wait until reset')

    t.end()
})