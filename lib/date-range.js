// Unit test: ../test/date-range

// parse month range string
// -> [firstYear, firstMonth, lastYear, lastMonth]
//
// supports:
//   YYYY-MM..YYYY-MM         month range
//   - Ay Bm                  since <y> years <m> months ago
//
// abbreviations:
//   Year:  y, yr, year
//   Month: m, mo, mth, month
//
// plural form is optional (does not matter)
function parseDateRange(str, refDate = new Date()) {
    str = str.trim()

    // parse 'since' style range
    if (str.startsWith('-')) {
        str = str.slice(1).trim()
        const reYear = /(\d+)\s*(?:yr|year|y)(?:s?)/
        const reMonth = /(\d+)\s*(?:mo|month|mth|mn|m)(?:s?)/

        const my = reYear.exec(str)
        const mm = reMonth.exec(str)

        const months = (my ? parseInt(my[1], 10) * 12 : 0)
                     + (mm ? parseInt(mm[1], 10) : 0)

        const toYear = refDate.getFullYear()
        const toMonth = refDate.getMonth() + 1

        const sinceYear = toYear - Math.floor(months / 12)
        const sinceMonth = toMonth - months % 12

        return sinceMonth <= 0
            ? [sinceYear - 1, sinceMonth + 12, toYear, toMonth]
            : [sinceYear, sinceMonth, toYear, toMonth]
    }

    // parse yyyy-MM..yyyy-MM
    const re = /^(\d{4})\s*-?\s*(\d{2})\s*(?:\.\.|-|\s*)\s*(\d{4})\s*-?\s*(\d{2})$/
    const m = re.exec(str)
    if (!m) throw new Error('Incorrect range format')

    const [y0, m0, y1, m1] = m.slice(1, 5)
    if (m0 < 1 || m0 > 12 || m1 < 1 || m1 > 12) throw new Error('Incorrect month range')

    // shift by 4 is enough to represent 1-12
    const date0 = (y0 << 4) + m0
    const date1 = (y1 << 4) + m1

    return (
        date0 > date1
        ? [y1, m1, y0, m0]
        : [y0, m0, y1, m1]
    ).map(num => parseInt(num, 10))
}

// left pad string <s> to length <n> using <char>
// -> String
function pad0(s, n = 2, char = '0') {
    return `${char.repeat(n)}${s}`.slice(-n)
}

// generate GitHub date range queries
// -> Generator that yields a GitHub date range query string (e.g. 2000-01..2000-02)
//
// current month granularity works ok in practice
// the extreme case is to use per day granularity
function* generateQueryDateRange(firstYear, firstMonth, lastYear, lastMonth) {
    let year = firstYear
    let month = firstMonth

    do {
        const nextMonth = month === 12 ? 1 : month + 1
        const nextYear = month === 12 ? year + 1 : year
        yield `${pad0(year, 4)}-${pad0(month, 2)}-01..${pad0(nextYear, 4)}-${pad0(nextMonth, 2)}-01`
        year = nextYear
        month = nextMonth
    } while ((year << 4) + month < (lastYear << 4) + lastMonth)
}

module.exports = {
    parseDateRange,
    generateQueryDateRange
}