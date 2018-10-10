module.exports = function breakLines(s) {
    return s.replace(/\n\r|\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}