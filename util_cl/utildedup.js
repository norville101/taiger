const fs = require('fs')
const path = require('path')
const { NightCafe } = require('../sources')

if (process.argv.length < 3) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

const dirPath = process.argv[2]
const localUsers = NightCafe.getUsers().map(username => { username })
localUsers.forEach(user => user.cache = NightCafe.getCreationCache(user.username))
try {
  // get a list of all files in the directory
  const files = fs.readdirSync(dirPath)
  const fnre = /^(\d+)\s(\w+)(.+)$/
  for (const file of files) {
    const matches = fnre.exec(file)
    if (matches) {
      const id = matches[2]
      for (const user of localUsers) {
        if (id in user.cache) {
          const oldPath = path.join(dirPath, file)
          const newPath = path.join(dirPath, user.username, file)
          fs.renameSync(oldPath, newPath)
          break
        }
      }
    }
  }
} catch (e) {
  console.error(e)
}
