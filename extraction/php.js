const breakLines = require('../lib/break-lines')

// context window
// set to very large integers to extract the whole file
const PHP_CONTEXT_WINDOW = 50

// parse patch's range hump to locate changes
function parseRangeHump(hump) {
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

// merge humps if they overlap
// Unit Test: ../test/merge-humps
function mergeHumps(humpStrs) {
    const humps = humpStrs.map(parseRangeHump).filter(isTruthy)
    if (!humps.length) return []

    const first = humps[0]

    let ret = [
        [
            Math.max(1, first[0] - PHP_CONTEXT_WINDOW),
            first[0] + first[1] + PHP_CONTEXT_WINDOW,
            Math.max(1, first[2] - PHP_CONTEXT_WINDOW),
            first[2] + first[3] + PHP_CONTEXT_WINDOW
        ]
    ]

    // abbr:
    //     l = left, r = right
    //     s = start, e = end,
    //     p = previous
    for (let i = 1; i !== humps.length; ++i) {
        const ls = Math.max(1, humps[i][0] - PHP_CONTEXT_WINDOW)
        const le = humps[i][0] + humps[i][1] + PHP_CONTEXT_WINDOW
        const rs = Math.max(1, humps[i][2] - PHP_CONTEXT_WINDOW)
        const re = humps[i][0] + humps[i][3] + PHP_CONTEXT_WINDOW

        const [pls, ple, prs, pre] = ret[ret.length - 1]
        // if any hump intersects, merge
        if (ls <= ple || rs <= pre) {
            // set previous one's left end and right end to current's
            ret[ret.length - 1][1] = le
            ret[ret.length - 1][3] = re
        } else {
            ret.push([ls, le, rs, re])
        }
    }

    return ret.map(arr => arr.join(','))
}


function extractLinesWithContext(lines, start, end, ctxWindow = PHP_CONTEXT_WINDOW) {
    const startAt = start - 1
    const endAt = Math.max(end, lines.length)
    return lines.slice(startAt, endAt).join('\n')
}

function isTruthy(o) {
    return o
}

module.exports = {
    extractFunctionFromHeaders(buf1, buf2, headers) {
        const lines1 = breakLines(buf1)
        const lines2 = breakLines(buf2)
        const humps = headers.map(line => line.split(',').map(num => parseInt(num, 10)))

        return humps.map(([leftStart, leftRange, rightStart, rightRange]) => ({
            name: `${leftStart}_${leftRange}`,
            before: extractLinesWithContext(lines1, leftStart, leftRange),
            after: extractLinesWithContext(lines2, rightStart, rightRange)
        }))
    },
    extractFunctionPatchHeadings(diff) {
        return mergeHumps(
            diff.split(/\n/g)
                .filter(line => line.startsWith('@@') && line.slice(2).includes('@@'))
                .map(line => line.slice(0, 2 + line.slice(2).indexOf('@@') + 2).trim())
        )
    },
    mergeHumps,
    PHP_CONTEXT_WINDOW
}