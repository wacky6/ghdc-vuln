const test = require('tape')
const dr = require('../lib/date-range')

test('date range', t => {
    t.deepEqual(dr.parseDateRange('201801-201812'), [2018, 1, 2018, 12])
    t.deepEqual(dr.parseDateRange('201801..201812'), [2018, 1, 2018, 12])
    t.deepEqual(dr.parseDateRange('2018-01-2018-12'), [2018, 1, 2018, 12])
    t.deepEqual(dr.parseDateRange('2018-01..2018-12'), [2018, 1, 2018, 12])
    t.deepEqual(dr.parseDateRange('2018-01 .. 2018-12'), [2018, 1, 2018, 12])
    t.deepEqual(dr.parseDateRange('2018-01  2018-12'), [2018, 1, 2018, 12])
    t.end()
})

test('date since', t => {
    // 9 and 10 are not typo, JS Date month starts from 0
    t.deepEqual(dr.parseDateRange('-1yr', new Date(2018, 9, 2)), [2017, 10, 2018, 10])
    t.deepEqual(dr.parseDateRange('-9mo', new Date(2018, 9, 2)), [2018, 1, 2018, 10])
    t.deepEqual(dr.parseDateRange('-10mo', new Date(2018, 9, 2)), [2017, 12, 2018, 10])
    t.deepEqual(dr.parseDateRange('-11mo', new Date(2018, 9, 2)), [2017, 11, 2018, 10])
    t.deepEqual(dr.parseDateRange('-12mo', new Date(2018, 9, 2)), [2017, 10, 2018, 10])
    t.deepEqual(dr.parseDateRange('-13mo', new Date(2018, 9, 2)), [2017, 9, 2018, 10])
    t.deepEqual(dr.parseDateRange('-1y1m', new Date(2018, 9, 2)), [2017, 9, 2018, 10])
    t.end()
})

test('date generate', t => {
    t.deepEqual([...dr.generateQueryDateRange(2018, 9, 2018, 10)], ['2018-09-01..2018-10-01'])
    t.deepEqual([...dr.generateQueryDateRange(2018, 8, 2018, 10)], ['2018-08-01..2018-09-01', '2018-09-01..2018-10-01'])
    t.deepEqual([...dr.generateQueryDateRange(2017, 11, 2018, 3)], ['2017-11-01..2017-12-01', '2017-12-01..2018-01-01', '2018-01-01..2018-02-01', '2018-02-01..2018-03-01'])
    t.deepEqual([...dr.generateQueryDateRange(2017, 1, 2019, 1)].length, 24)
    t.end()
})