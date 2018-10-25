// break string into lines without merging multiple spaces
// take care of macOS and Windows line endings
// -> String
module.exports = function breakLines(s) {
    return s.replace(/\n\r|\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}