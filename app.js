const express = require('express')
const fastq = require('fastq').promise
const bodyParser = require('body-parser')
const { Controller } = require('./controller')
const { StarryAI, NightCafe, Novita } = require('./sources')
// const fileExtension = require('file-extension')
// const contentDisposition = require('content-disposition')
// const mime = require('mime-types')
const cors = require('cors')

const controller = new Controller()
const queue = fastq(onProcessItem, 1)

const app = express()
const jsonParser = bodyParser.json({limit: "50mb"})
const port = 3030

let eventClients = []

app.use(cors({ allowedHeaders: ['Content-Type']}))

app.use(express.static('client'))

app.post('/download', jsonParser, async (req, res) => {
  const item = req.body
  const compressed = getBoolQueryParam('compressed', req.query)
  const addingCount = Array.isArray(item) ? item.length : 1
  sendEventsToAll(getQueueInfo(null, addingCount))
  if (Array.isArray(item)) { // assume order is newer to older; enqueue oldest first
    for (let i = item.length - 1; i >= 0; i--) {
      let thisItem = item[i]
      thisItem.__options = { compressed }
      queue.push(thisItem)
    }
  } else {
    item.__options = { compressed }
    queue.push(item)
  }
  res.send({})
  // sendError(res, 400)

  // send download to requester
  // res.setHeader('Content-Type', getMimeForFileName(filepath))
  // res.setHeader('Content-Disposition', contentDisposition(filepath))
  // res.send(file.toBuffer())
  // res.download(filepath)
})

app.post('/nightraw', express.raw({ type: '*/*', limit: "50mb" }), async (req, res) => {
  const item = req.body.toString()
  const jobs = NightCafe.getJobs(item)
  const toRemember = NightCafe.omitPreviouslyDownloaded(jobs)
  const toDownload = NightCafe.omitUploads(toRemember, true)
  toDownload.reverse() // switch from most-recent-first to oldest-first
  sendEventsToAll(getQueueInfo(null, toDownload.length))
  for (const creation of toDownload) {
    queue.push(creation)
  }
  res.send({})
  await NightCafe.registerAsDownloaded(jobs)
  // sendError(res, 400)
})

app.post('/starryai/download', jsonParser, async (req, res) => {
  const item = req.body
  const compressed = getBoolQueryParam('compressed', req.query)
  const allSince = getBoolQueryParam('allSince', req.query)
  const upscalesOnly = getBoolQueryParam('upscalesOnly', req.query)
  let toDownload
  if (allSince) {
    toDownload = await StarryAI.getAllCreationMetadataSince(item.url, item.token)
  } else {
    const meta = await StarryAI.getCreationMetadata(item.url, item.token)
    if (meta) toDownload = [meta]
  }
  if (toDownload && Array.isArray(toDownload)) {
    sendEventsToAll(getQueueInfo(null, toDownload.length))
    while (toDownload.length > 0) {
      let thisItem = toDownload.pop()
      if (thisItem) {
        thisItem.__options = { compressed, upscalesOnly }
        queue.push(thisItem)
      }
    }
  } else {
    console.error('failed to retrieve starryai metadata')
  }
})

app.post('/starryai/liked', jsonParser, async (req, res) => {
  const item = req.body
  const compressed = getBoolQueryParam('compressed', req.query)
  const result = await StarryAI.getNewLikedPublicCreations(item.token, true)
  if (result) {
    console.log(`Retrieved metadata about ${result.length} creations; adding to download queue`)
    while (result.length > 0) {
      let thisItem = result.pop()
      if (thisItem) {
        thisItem.__options = { compressed }
        queue.push(thisItem)
      }
    }
  } else {
    console.error('failed to retrieve liked creations')
  }
})

app.post('/fetch', jsonParser, async (req, res) => {
  const item = req.body
  const url = new URL(item.url)
  let result, username
  if (url.hostname === 'api.nightcafe.studio') {
    username = NightCafe.getUserName(url.searchParams.get('user'))
    result = await NightCafe.getSeries(item.url, item.headers, username)
    if (result && result.length) {
      result = NightCafe.omitOwnCreations(result).reverse() // change to oldest first
      console.log(`Omitting own creations, adding ${result.length} to download queue`)
    }
  }
  if (result) {
    if (result.length > 0) {
      sendEventsToAll(getQueueInfo(null, result.length))
    }
    for (const creation of result) {
      queue.push(creation)
    }
    NightCafe.registerAsLiked(username, result)
  } else {
    console.error('failed to fetch creations')
  }
})

app.post('/novita/txt2img', jsonParser, async (req, res) => {
  // debugger
  sendEventsToAll(`Requesting Novita txt2img (${req.body.image_num})`)
  const item = await Novita.txt2img(req.body)
  sendEventsToAll(getQueueInfo(null, 1))
  queue.push(item)
  res.send({})
})

app.post('/starryai/models/new', jsonParser, async (req, res) => {
  const item = req.body
  const result = await StarryAI.getNewModels(item.token)
  if (result && result.length) {
    console.log(`Data retrieved for ${result.length} published model${result.length === 1 ? '' : 's'}`)
  } else {
    console.log('No new models have been published')
  }
})

app.post('/starryai/claim', jsonParser, async (req, res) => {
  const item = req.body
  const result = await StarryAI.claimCredits(item.token)
  if (result && result.success && result.user) {
    console.log(`claimed credits for user ${result.user.userName}; ${result.user.totalCredits} available`)
  } else {
    console.error(`failed to claim credits`)
  }
})

app.post('/starryai/delvar', jsonParser, async (req, res) => {
  const item = req.body
  const result = await StarryAI.deleteVariation(item.token, item.url, item.varNum)
  if (result) {
    console.log(`variation ${item.varNum} has been deleted`)
  } else {
    console.error(`failed to delete variation ${item.varNum}`)
  }
})

app.post('/starryai/meta/published', jsonParser, async (req, res) => {
  const item = req.body
  const result = await StarryAI.getAllPublishedCreations(item.token)
  if (result) {
    console.log(`metadata about ${result.length} published creations has been cached locally`)
  } else {
    console.error('failed to retrieve published creations')
  }
})

app.post('/starryai/meta/all', jsonParser, async (req, res) => {
  const item = req.body
  const result = await StarryAI.getAllSummaryCreations(item.token)
  if (result) {
    console.log(`summary metadata about ${result} published creations has been cached locally`)
  } else {
    console.error('failed to retrieve all summary metadata')
  }
})

app.post('/cleaner', jsonParser, async (req, res) => {
  const item = req.body
  await controller.cleanFilesInDir(item.dir)
  res.send({})
})

app.get('/status', (req, res) => res.json({ clientCount: eventClients.length }))

app.get('/events', sendEvent)

app.listen(port, () => {
  console.log(`Downlaider listening on port ${port}` + '\n\n' + `Monitor at http://localhost:${port}/index.html`)
})

/*****************************************************************************************************/
// Work queue and event stuff

async function onProcessItem (item) {
  await controller.doWork(item)
  sendEventsToAll(getQueueInfo(item.id))
}

function getQueueInfo (idDone, addCount) {
  const result = {}
  if (idDone) {
    result.done = idDone
  }
  result.remain = queue.length()
  if (addCount) {
    result.adding = addCount
    result.newRemain = result.remain + addCount
  }
  return result
}

function sendEvent (request, response, next) {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  }
  response.writeHead(200, headers)

  const data = `data: ${JSON.stringify(getQueueInfo())}\n\n`
  response.write(data)

  const clientId = Date.now()
  const newClient = {
    id: clientId,
    response: response
  }
  eventClients.push(newClient)

  request.on('close', () => {
    console.log(`${clientId} Connection closed`);
    eventClients = eventClients.filter(client => client.id !== clientId);
  })
}

function sendEventsToAll(eventInfo) {
  eventClients.forEach(client => client.response.write(`data: ${JSON.stringify(eventInfo)}\n\n`))
}

function getBoolQueryParam (name, query) {
  if (!(name in query)) return false
  let value = query[name]
  if (!value) return true // usually empty string -- just name == true by default
  value = value.toLowerCase()
  if (value === '0' || value === 'false' || value === 'no') return false
  return true
}

// function sendError (
//   res, defaultCode, error = undefined, messageOverride = undefined) {
//   if (error && error.code) {
//     res.status(error.code).send(messageOverride || error.message)
//   } else if (messageOverride) {
//     res.status(defaultCode).send(messageOverride)
//   } else {
//     res.sendStatus(defaultCode)
//   }
// }

// function getMimeForFileName (filename, defaultMime = 'application/octet-stream') {
//   const ext = fileExtension(filename)
//   const mimeType = mime.lookup(ext)
//   if (mimeType) {
//     return mimeType
//   }
//   return defaultMime
// }
