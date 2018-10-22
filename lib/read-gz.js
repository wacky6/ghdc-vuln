const promisify = require('util').promisify
const zlib = require('zlib')
const gunzip = promisify(zlib.gunzip)
const fs = require('fs').promises
const { extname } = require('path')

function unpackBuffer(encoding) {
    return encoding ? buf => buf.toString(encoding) : buf => buf
}

module.exports = async function readGzFile(filename, encoding = null) {
    if (extname(filename).toLocaleLowerCase() === '.gz') {
        return fs.readFile(filename, {encoding: null}).then(gunzip).then(unpackBuffer(encoding))
    } else {
        return fs.readFile(filename, {encoding})
    }
}