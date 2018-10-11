module.exports = function parseRangeHump(hump) {
    if (!hump.startsWith('@@') || !hump.endsWith('@@')) return null

    const range = hump.slice(2, -2)
    const reHumpRange = /-(\d+),(\d+)\s*\+(\d+),(\d+)/

    const m = reHumpRange.exec(range)
    if (m) {
        return [
            parseInt(m[1], 10),
            parseInt(m[2], 10),
            parseInt(m[3], 10),
            parseInt(m[4], 10)
        ]
    } else {
        return null
    }
}
