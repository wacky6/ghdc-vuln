const promisify = require('util').promisify
const zlib = require('zlib')
const gunzip = promisify(zlib.gunzip)
const fs = require('fs').promises
const { extname } = require('path')

function unpackBuffer(encoding) {
    return encoding ? buf => buf.toString(encoding) : buf => buf
}

function readGzFile(filename, encoding = null) {
    if (extname(filename).toLocaleLowerCase() === '.gz') {
        return fs.readFile(filename, {encoding: null}).then(gunzip).then(unpackBuffer(encoding))
    } else {
        return fs.readFile(filename, {encoding})
    }
}

function readGzJson(filename) {
    return readGzFile(filename, 'utf-8').then(str => JSON.parse(str))
}

function isGzJson(filename) {
    return extname(filename).toLowerCase() === '.json'
       || (extname(filename).toLowerCase() === '.gz' && extname(filename, 'gz').slice(0, -3).toLowerCase() === '.json')
}

module.exports = {
    readGzFile,
    readGzJson,
    isGzJson
}