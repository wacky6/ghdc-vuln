const breakLines = require('../lib/break-lines')
const parseRangeHump = require('../lib/parse-diff-range-hump')

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

// lines: array of file lines
// header: diff header, usually function decleration
// hint: line number hint (as given in patch's range)
function extractFromHeader(lines, header, hint) {
    // find header occurance
    const hits = []
    for (let i = 0; i < lines.length; ++i) {
        if (lines[i].includes(header))
            hits.push(i)
    }

    // find the hit that is closest to patched location
    const startLine = hits.sort((a, b) => Math.abs(a-hint) - Math.abs(b-hint))[0]
    if (!startLine) return null

    let fnBody = ''
    // check previous line for type
    if (startLine > 1) {
        const typeDecl = lines[startLine - 1]
        const re_type_decl = /^[a-zA-Z0-9_*()\[\] ]$/
        if (typeDecl.trim().match(re_type_decl)) {
            fnBody += (typeDecl + '\n')
        }
    }

    // start extraction based on bracket level / depth
    for (let i = startLine; i < lines.length; ++i) {
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

        return headers.map(header => {
            const [_, hump, patchHeader] = header.split('@@')
            const fnSignature = patchHeader.trim()
            const [ls, le, rs, re] = parseRangeHump('@@ ' + hump.trim() + ' @@')
            return {
                name: guessFunctionNameFromHeader(fnSignature),
                before: extractFromHeader(lines1, fnSignature, ls),
                after: extractFromHeader(lines2, fnSignature, rs)
            }
        }).filter(pair => pair && pair.before !== pair.after && pair.name)
    },
    extractFunctionPatchHeadings(diff) {
        return [
            ...new Set(
                diff.split(/\n/g)
                    .filter(line => line.startsWith('@@') && line.slice(2).includes('@@'))
            )
        ].filter(h => h.includes('('))
    }
}