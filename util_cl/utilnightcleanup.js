const fs = require('fs')
const path = require('path')
const { NightCafe } = require('../sources')

if (process.argv.length < 3) {
  console.error('Expected at least one argument!');
  process.exit(1);
}

const dirPath = process.argv[2]
try {
  // get a list of all files in the directory
  const files = fs.readdirSync(dirPath)
  const toDelete = {}
  for (const metafile of files.filter(f => f.endsWith('.metadata.json'))) {
    let modified = false
    const filepath = path.join(dirPath, metafile)
    let source = JSON.parse(fs.readFileSync(filepath))
    // drill into pageProps, if present
    if (source.pageProps) {
      source = source.pageProps
      modified = true
    }
    // drill into initialJob, if present
    if (source.initialJob) {
      source = source.initialJob
      modified = true
    }
    if (modified) {
      fs.writeFileSync(filepath, JSON.stringify(source), 'utf-8')
    }
    if (source.jobType === 'upload') {
      if (source.progressImages?.some(pi => pi.iteration === 'upscale')) {
        // might be worth keeping
      } else {
        toDelete[metafile.slice(0, -14)] = { id: source.id, meta: metafile }
      }
    }
  }
  const fnre = /^\d+\s\w+/
  for (const file of files) {
    const matches = fnre.exec(file)
    if (matches) {
      if (matches[0] in toDelete) {
        const oldPath = path.join(dirPath, file)
        const newPath = path.join(dirPath, 'todelete', file)
        fs.renameSync(oldPath, newPath)
      }
    }
  }
} catch (e) {
  console.error(e)
}
