const { mergeHumps } = require('../extraction/php')

const test = require('tape')

test('start hump trim', t => {
    t.deepEqual(
        mergeHumps(['@@ -1,5 +1,5 @@']),
        ['1,56,1,56']
    )

    t.deepEqual(
        mergeHumps(['@@ -1,5 +1,5 @@', '@@ -10,1 +10,1 @@', '@@ -30,1 +30,1 @@']),
        ['1,81,1,81']
    )
    t.end()
})
