const fs = require('fs')
const path = require('path')
const { TimeFromCode32, TimeCodeNum, TimeFromCodeNum, TimeCodeHR } = require('../utils')

if (process.argv.length < 3) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

//const timecode32RE = /^([aäbcdeëfghiïjklmnoöpqrstuüvwxyÿz]{6})\s/
const timecodeNumRE = /^(\d{9})\s/
const oldCodeLen = 9 // 6

const dirPath = process.argv[2]
try {
  renameInDir(dirPath, true)
} catch (e) {
  console.error(e)
}

function renameInDir (dirPath, recursive) {
  // get a list of all files in the directory
  const files = fs.readdirSync(dirPath)
  for (const filename of files) {
    const oldPath = path.join(dirPath, filename)
    const matches = timecodeNumRE.exec(filename) // timecode32RE.exec(file)
    if (matches) {
      const oldCode = matches[1]
      const creationTime = TimeFromCodeNum(oldCode) //TimeFromCode32(oldCode)
      const newCode = TimeCodeHR(creationTime) // TimeCodeNum(creationTime)
      const newName = newCode.toString() + filename.slice(oldCodeLen)
      const newPath = path.join(dirPath, newName)
      fs.renameSync(oldPath, newPath)
    } else if (recursive && fs.statSync(oldPath).isDirectory()) {
      // recurse
      renameInDir(oldPath, recursive)
    }
  }
}
