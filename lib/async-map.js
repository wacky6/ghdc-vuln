const async = require('async')

// asynchronously map an array using <linit> parallel executing <fn> function
// -> Promise(array)
function asyncMap(arr, limit, fn) {
    return new Promise((resolve, reject) => {
        async.mapLimit(arr, limit, fn, (err, results) => !err ? resolve(results) : reject(err))
    })
}

module.exports = asyncMap