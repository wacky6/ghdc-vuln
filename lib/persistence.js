// persistence helper

const {
    readFileSync,
    writeFileSync
} = require('fs')

module.exports = {
    persistTaskState(name, taskParam) {
        return writeFileSync(`${name}.ghdc.json`, JSON.stringify(taskParam, null, '  '))
    },
    restoreTaskState(name, defaultParam) {
        try {
            const taskParam = JSON.parse(readFileSync(`${name}.ghdc.json`, {encoding: 'utf-8'}))
            return {
                ...defaultParam,
                ...taskParam
            }
        } catch(e) {
            return defaultParam
        }
    }
}