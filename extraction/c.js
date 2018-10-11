const breakLines = require('../lib/break-lines')

// NOTE: should rewrite to an appropriate parser
//       current heuristic guess works ok though.
function guessFunctionNameFromHeader(header) {
    const idxParn = header.indexOf('(')
    if (idxParn >= 0) {
        const idxLastSpace = Math.max(header.slice(0, idxParn).trim().lastIndexOf(' '), 0)
        return header.slice(idxLastSpace, idxParn).replace(/[^a-zA-Z0-9_]/g, '')
    } else {
        // can not guess
        return header
    }
}

function extractFromHeader(lines, header) {
    for (let i = 0; i < lines.length; ++i) {
        if (!lines[i].includes(header)) continue

        // start extraction based on bracket level / depth
        let fnBody = ''
        let bracketLevel = 0
        let encounteredFirstBracket = false
        while (
            i < lines.length
            && (!encounteredFirstBracket || bracketLevel > 0)
        ) {
            for (const ch of lines[i]) {
                if (ch === '{') {
                    bracketLevel += 1
                    encounteredFirstBracket = true
                }
                if (ch === '}') {
                    bracketLevel -= 1
                }
            }
            fnBody += (lines[i] + '\n')
            ++i
        }

        return fnBody
    }
    return ''
}

module.exports = {
    extractFunctionFromHeaders(buf1, buf2, headers) {
        const lines1 = breakLines(buf1)
        const lines2 = breakLines(buf2)

        return headers.map(header => ({
            name: guessFunctionNameFromHeader(header),
            before: extractFromHeader(lines1, header),
            after: extractFromHeader(lines2, header)
        })).filter(pair => pair && pair.before !== pair.after && pair.name)
    },
    extractFunctionPatchHeadings(diff) {
        return [
            ...new Set(
                diff.split(/\n/g)
                    .filter(line => line.startsWith('@@') && line.slice(2).includes('@@'))
                    .map(line => line.slice(2 + line.slice(2).indexOf('@@') + 2).trim())
            )
        ].filter(h => h.includes('('))
    }
}