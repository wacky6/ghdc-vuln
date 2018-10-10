const { execFile: _execFile } = require('child_process')
const promisify = require('util').promisify
const execFile = promisify(_execFile)

module.exports = {
    clone(url, dest, cwd) {
        return execFile('git', ['clone', url, dest], { maxBuffer: 64 * 1024 * 1024, cwd })
    },

    checkout(treeish, cwd) {
        return execFile('git', ['checkout', '-f', treeish], { cwd })
    }
}