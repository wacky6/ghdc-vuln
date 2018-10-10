const fs = require('fs').promises

// NOTE: should rewrite to an appropriate parser
//       current heuristic guess works ok though.
function guessFunctionNameFromHeader(header) {
    const idxParn = header.indexOf('(')
    if (idxParn >= 0) {
        const idxLastSpace = Math.max(header.slice(0, idxParn).lastIndexOf(' '), 0)
        return header.slice(idxLastSpace, idxParn).replace(/[^a-zA-Z0-9_]/g, '')
    } else {
        // can not guess
        return header
    }
}

module.exports = {
    extractFunctionFromHeaders(file, headers) {
        return fs.readFile(file, {encoding: 'utf-8'}).then(buf => {
            let ret = []
            const lines = buf.split(/[\n\r]+/)
            for (let i = 0; i < lines.length; ++i) {
                const header = headers.find(header => lines[i].includes(header))
                if (!header) continue

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

                ret.push({
                    name: guessFunctionNameFromHeader(header),
                    body: fnBody
                })
            }
            return ret
        })
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