const fs = require('fs')
const path = require('path')
const { setTimeout } = require('node:timers/promises')
const axios = require('axios')
const { PARAM } = require('../mdparams')
const { RemoteImageFile } = require('../image')
const { GetFilenameExtension } = require('../utils')
const { FireBaseDocuments } = require('./firebase')

const base_image_url = 'https://storage.googleapis.com/nightcafe-creator.appspot.com'

const stateDir = path.join(__dirname, '..', 'state', 'nightcafe')
const configPath = path.join(__dirname, '..', 'config', 'nightcafe.json')
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  : { users: [] }

function isMatch (source) {
  return source.pageProps && source.pageProps.initialJob && source.pageProps.cid
    || source.id && source.runtime && source.algorithm && source.status
    || source.id && source.status && source.jobType === 'upload'
}

function getSize (source) {
  if (source.progressImages) {
    const pi = source.progressImages.find(i => !i.isGrid)
    if (pi) return { width: pi.width, height: pi.height }
  }
  return { width: source.outputWidth, height: source.outputHeight }
}

function aggregatePrompts(prompts, negative) {
  let subset = prompts
    .filter(p => negative ? p.weight < 0 : !p.weight || p.weight > 0)
    .map(p => ({ prompt: p.prompt, weight: p.weight ? Math.abs(p.weight) : 1.0 }))
    .sort((a, b) => b.weight - a.weight)
  return subset
    .map(p => p.weight !== 1.0 ? `(${p.prompt}:${p.weight})` : p.prompt)
    .join('\nBREAK\n')
}

async function sourceToCreation (source, creation, options) {
  creation.createdBy = 'NightCafe'
  let cid
  // drill into pageProps, if present
  if (source.pageProps) source = source.pageProps
  if (source.cid) cid = source.cid
  // drill into initialJob, if present
  if (source.initialJob) source = source.initialJob

  if (source.id) {
    if (cid && cid !== source.id) console.log('warning: id mismatch!')
      cid = source.id
  }
  creation.id = cid
  creation.orderById = false // which means a time-based prefix will be added and title omitted from filename
  if (source.created) {
    creation.createdAt = new Date(source.created)
  }
  if (source.hotnessLastUpdatedAt) {
    creation.updatedAt = new Date(
      source.hotnessLastUpdatedAt._seconds
        ? source.hotnessLastUpdatedAt._seconds * 1000
        : source.hotnessLastUpdatedAt
    )
  }
  if (source.postedDate) {
    creation.publishedAt = new Date(source.postedDate)
  }
  // creation.idShort = creation.timePrefix
  if (source.title) creation.title = source.title.trim()
  creation.url = 'https://creator.nightcafe.studio/creation/' + cid
  if (source.showPrompts !== false) {
    creation.prompts = source.prompts.map((prompt, idx) => ({
      prompt,
      weight: source.promptWeights && source.promptWeights[idx],
    }))
    creation.prompt = aggregatePrompts(creation.prompts, false)
    creation.negativePrompt = aggregatePrompts(creation.prompts, true)
    if (source.negativePrompt && !creation.negativePrompt) {
      creation.negativePrompt = source.negativePrompt
    }
  }
  if (!creation.prompt && source.title) {
    creation.prompt = source.title
  }
  if (source.evolvedFrom) {
    creation.sourceImageId = source.evolvedFrom
  } else if (source.startImage && source.showStartImage !== false) {
    if (source.startImage.id && source.startImage.id !== 'hidden') {
      creation.sourceImageId = source.startImage.id
    } else if (source.startImage.data?.jobId) {
      creation.sourceImageId = source.startImage.data.jobId
    }
    if (source.startImage.path && source.startImage.path !== 'hidden') {
      creation.sourceImageUrl = base_image_url + source.startImage.path
    }
  }
  creation.setParam(PARAM.steps, source.runtime || 'unknown')
  const size = getSize(source)
  if (size.width && size.height) {
    creation.setParam(PARAM.size, `${size.width}x${size.height}`)
  }
  let seed
  if (Array.isArray(source.seed))
    seed = source.seed[0]
  else
    seed = source.seed
  if (typeof seed === 'number' && seed >= 0) {
    creation.setParam(PARAM.seed, seed)
  }
  creation.setParam('Service', creation.createdBy)
  if (source.algorithm) creation.setParam('Algorithm', source.algorithm)
  switch (source.algorithm) {
    case 'diffusion2':
      if (source.sdEngine) {
        creation.setParam(PARAM.model, source.sdEngine)
      }
      break
    case 'flux':
      if (source.fluxModel) {
        creation.setParam(PARAM.model, source.fluxModel)
      }
      break
    case 'dalle3':
      if (source.dalle3Style) {
        creation.setParam(PARAM.model, source.dalle3Style)
      }
      break
    case 'imagen':
      if (source.imagenModel) {
        creation.setParam(PARAM.model, source.imagenModel)
      }
      break
    default:
      if (source.jobType === 'upload' && source.model) {
        creation.setParam(PARAM.model, source.model)
      } else {
        console.log(`${creation.timePrefix} id ${creation.id} uses unrecognized algorithm '${source.algorithm}'`)
      }
  }
  if (!creation.images) {
    creation.images = []
  }
  if (source.progressImages && source.progressImages.length > 0) {
    source.progressImages.forEach((img, i) => {
      const outputUrl = base_image_url + img.output
      const urlExt = GetFilenameExtension(img.output) || '.jpg'
      const imgName = path.basename(img.output, urlExt)
      const newImg = new RemoteImageFile(outputUrl, urlExt)
      newImg._orig_meta = img
      // newImg.fnPrefix = creation.timePrefix + ' ' + creation.id // no op
      newImg.reelName = creation.id
      const info = parseImageInfo(img, i, source.progressImages)
      newImg.fnImageNum = info.imageNum
      if (isNaN(newImg.fnImageNum)) {
        newImg.imageNumber = 0
      } else {
        newImg.imageNumber = Number.parseInt(newImg.fnImageNum)
      }
      newImg.uniqueId = imgName.replace(/\-/g, '')
      newImg.createdAt = new Date(creation.createdAt || creation.updatedAt)
      if (img.seed) {
        newImg.seedOverride = img.seed
      }
      if (info.fnScale) {
        newImg.fnScale = info.fnScale
      }
      creation.images.push(newImg)
    })
  } else if (source.output) { // single creation (no progressImages array)
    const outputUrl = base_image_url + source.output
    const urlExt = GetFilenameExtension(source.output) || '.jpg'
    const newImg = new RemoteImageFile(outputUrl, urlExt)
    newImg._orig_meta = source
    // newImg.fnPrefix = creation.timePrefix // no op
    newImg.reelName = creation.id
    newImg.fnImageNum = "1"
    newImg.imageNumber = 1
    newImg.uniqueId = path.basename(source.output, urlExt).replace(/\-/g, '')
    newImg.createdAt = new Date(creation.createdAt || creation.updatedAt)
    newImg.seedOverride = source.seed
    creation.images.push(newImg)
  }
}

function parseImageInfo (img, index, allImages) {
  let imageNum, extras = []
  const urlExt = GetFilenameExtension(img.output) || '.jpg'
  const imgName = path.basename(img.output, urlExt)
  let upscaleOriginal, origInfo
  upscaleOriginal = img.upscaleOriginal || (img.iteration === 'upscale' && img.inputProgressImage)
  if (upscaleOriginal) {
    // try to find original in allImages
    let origIndex = allImages.findIndex(i => i.output === upscaleOriginal.output)
    let orig = origIndex >= 0 ? allImages[origIndex] : null
    origInfo = parseImageInfo(orig || upscaleOriginal, origIndex, allImages)
  }
  if (origInfo) {
    imageNum = origInfo.imageNum || 'n'
    if (origInfo.fnScale) {
      extras.push(origInfo.fnScale)
    }
  }
  // now get stuff from filename
  let idparts = parseFileName(imgName)
  if (!imageNum) {
    if (idparts.num) {
      imageNum = idparts.num
    } else {
      imageNum = (index + 1).toString()
    }
  }
  if (idparts.adjustment)
    extras.push(idparts.adjustment)
  if (idparts.adjId)
    extras.push(idparts.id)
  return { imageNum, fnScale: extras.join('-') }
}

function parseFileName (imgName) {
  let id, num, baseId, adjustment, adjId
  let nameParts = imgName.split('--', 3)
  if (nameParts.length > 1) {
    // gIjPNOOkjzLU4D8ITIJb--4--1J9BD                          (numbered item in gallery, own or shared)
    // gIjPNOOkjzLU4D8ITIJb--4--1J9BD_2x-clty-upscale-stb4e    (upscale of numbered item, shared)
    // YEU9oqRaRA1XS5Eez9ag--2--30ESX_2x-clty-upscale-1mkz5    (upscale of numbered item, shared)
    // qxfMsSLm8ewpRdgH8MQS--1--iog55_7.8125x-real-esrgan-x4-plus
    // l8EIQWpfGdF7Y5MabF59--1--w89yf_adetailer-face_yolov8n-y2vdo
    // l8EIQWpfGdF7Y5MabF59--1--w89yf_adetailer-face_yolov8n-znfi3
    // 7c4Yn5HiXBxcHktUES85--1--6l2s2_2x-real-esrgan-x4-plus_1x-clty-upscale-ijib2
    id = nameParts[0]
    num = nameParts[1]
    if (nameParts.length > 2 && nameParts[2]) {
      const p = nameParts[2].indexOf('_')
      if (p >= 0) {
        baseId = nameParts[2].slice(0, p)
        adjustment = nameParts[2].slice(p+1)
      } else {
        baseId = nameParts[2]
      }
    }
  } else {
    nameParts = imgName.split('_', 2)
    if (nameParts.length > 1) {
      // ZRBYrAmrU5NCHwQrdlm1-PdBpS_4x-real-esrgan-x4-plus   (own: upscale of an upload)
      // kVD3SpbHob49l8wDRD3H-pW0eq-adjusted_bg-rmvd         (shared)
      adjustment = nameParts[1]
      const part1 = parseFileName(nameParts[0])
      id = part1.id
      baseId = part1.baseId
      if (part1.adjustment) adjustment = part1.adjustment + '-' + adjustment
      if (part1.adjId) adjId = part1.adjId
    } else {
      nameParts = imgName.split('-', 3)
      if (nameParts.length > 1) {
        // ZRBYrAmrU5NCHwQrdlm1-PdBpS                          (own: upload)
        // YEU9oqRaRA1XS5Eez9ag-io3i6-adjusted                 (adjustment of another upscale or adjustment, shared)
        id = nameParts[0]
        if (nameParts.length == 2) {
          baseId = nameParts[1]
        } else {
          adjId = nameParts[1]
          adjustment = nameParts[2]
        }
      }
    }
  }
  return { id, num, baseId, adjustment, adjId }
}

async function getLikedCache (username) {
  let cacheName = path.join(stateDir, username + '.likes.json')
  if (!fs.existsSync(cacheName))
    return {}

  const cacheArray = JSON.parse(fs.readFileSync(cacheName, 'utf-8'))
  const result = {}
  cacheArray.forEach(id => {
    result[id] = 1
  })
  return result
}

async function registerAsLiked (username, docArray) {
  let cacheName = path.join(stateDir, username + '.likes.json')
  const cacheArray = fs.existsSync(cacheName)
    ? JSON.parse(fs.readFileSync(cacheName, 'utf-8'))
    : []
  for (const creation of docArray) {
    cacheArray.push(creation.id)
  }
  // backup
  fs.renameSync(cacheName, cacheName + '.bak') // silently replaces any existing backup
  // save updated cache
  return fs.promises.writeFile(cacheName, JSON.stringify(cacheArray))
}

function getUserName (userId) {
  let result = config.users[userId]
  if (!result) {
    throw new Error(`Username for ID ${userId} not found in nightcafe.config`)
  }
  return result
}

function getJobs (rawFirebase) {
  return FireBaseDocuments(rawFirebase, 'jobs')
}

async function getSeries (url, headers, username) {
  // retrieve results page by page, going back until we encounter one that has already been cached
  // (otherwise it goes back as far as it's able to)
  const strResults = 'results'
  const strContinuation = 'lastVisibleId'
  const cache = await getLikedCache(username)
  const newResults = [] // will be in reverse chronological order (newest first)
  let done = false
  let pageResponse, continuationValue
  do {
    let thisUrl = continuationValue
      ? `${url}&${strContinuation}=${continuationValue}`
      : url
    pageResponse = await httpGetPage(thisUrl, headers)
    if (pageResponse && pageResponse[strResults] && pageResponse[strResults].length > 0) {
      console.log(`(retrieved metadata for ${pageResponse[strResults].length} creations)`)
      for (const thisResult of pageResponse[strResults]) {
        if (thisResult.id in cache) {
          done = true
        } else {
          newResults.push(thisResult)
        }
      }
      continuationValue = pageResponse[strContinuation]
      if (continuationValue && !done) {
        await setTimeout(2000) // avoid calling too rapidly; space it out
      }
    } else {
      done = true
    }
  } while (!done && continuationValue)
  console.log(`(finished retrieving metadata for ${newResults.length} total creations)`)
  return newResults
}

async function httpGetPage (url, headers) {
  delete headers["if-none-match"]
  try {
    const response = await axios({
      method: 'get',
      maxBodyLength: Infinity,
      url,
      headers,
    })
    if (response) {
      const rspData = response.data
      if (rspData) {
        return rspData
      }
    }
  } catch (e) {
    let message = e.response?.data?.errors?.map(err => err.message + ' ' + JSON.stringify(err.locations)).join('\n')
      || e.code || `${e.name}: ${e.message}`
    if (e.stack) message += '\n' + e.stack
    console.error(message)
  }
}

function filterNewCreations (jobs) {
  const newJobs = omitPreviouslyDownloaded(jobs)
  const newCreations = omitUploads(newJobs, true)
  newCreations.reverse() // switch from most-recent-first to oldest-first
  return newCreations
}

/* pass in an array of "liked" creations, and this will filter out any that
   were created by our own (known) users, so we only download those from 3rd parties. */
function omitOwnCreations (docArray) {
  const omitUsers = Object.values(config.users)
  return omitUsers.length > 0
    ? docArray.filter(doc => !omitUsers.includes(doc.userInfo.username))
    : docArray
}

function getCreationCache (username) {
  const cacheName = path.join(stateDir, `${username}.creations.json`)
  return fs.existsSync(cacheName)
    ? JSON.parse(fs.readFileSync(cacheName))
    : {}
}

/* pass in an array of "my creations" (extracted from raw FireBase feed) and this will
  look for the first document in the array that we have a record of already downloading
  in the past. It will return the array truncated at that point, to avoid duplicate downloads.
  Uses local `username.creations.json` file to avoid redundant downloads!
*/
function omitPreviouslyDownloaded (docArray) {
  if (!docArray || !docArray.length) {
    return []
  }
  // extract username so we know which user created these items
  const userName = docArray[0].userInfo?.username
  // read in the creations cache for that username, if it exists
  const cacheName = path.join(stateDir, `${userName}.creations.json`)
  let cache, existingCache, overlapFound
  if (fs.existsSync(cacheName)) {
    const buf = fs.readFileSync(cacheName)
    cache = JSON.parse(buf)
    existingCache = true
  } else {
    cache = {}
    existingCache = false
  }
  if (existingCache) { // if it exists, scan through docs looking for overlap with the queue
    let result = []
    for (const doc of docArray) {
      if (doc.id in cache) {
        overlapFound = true
        break
      } else {
        result.push(doc)
      }
    }
    // if there IS overlap, download only new docs, then add downloaded docs to the cache and save it
    if (overlapFound) {
      return result
    } else { // if NO overlap, give a warning message about how there is no overlap
      console.log('No overlap found between the given creations and what has previously been downloaded. Try again going further back?')
      return []
    }
  } else { // if it does not exist, download everything and save the downloaded stuff in a new cache
    return docArray
  }
  //             --> update and save cache with each individual download, for interruption tolerance
  //       in which case, maybe here we just add every doc to the queue, and we leave it for
  //       the CONTROLLER to decide (using the cache) whether each item should be downloaded or not?!
  //         not sure... reading, modifying, and saving the queue for EVERY download seems wasteful??
}

function omitUploads (docArray, unlessUpscaled = true) {
  if (unlessUpscaled) {
    return docArray
      .filter(d => d.jobType !== 'upload' || doc.progressImages?.some(pi => pi.iteration === 'upscale'))
  }
  // else just omit all upscales
  return docArray
    .filter(d => d.jobType !== 'upload')
}

// pass in an array of "my creations" and this will cache each of them as having been previously downloaded.
async function registerAsDownloaded (docArray) {
  if (!docArray || !Array.isArray(docArray)) {
    throw new Error('Invalid docArray passed to registerAsDownloaded')
  }
  // extract username so we know which user created these items
  const userName = docArray[0].userInfo?.username
  // read in the creations cache for that username, if it exists
  const cacheName = path.join(stateDir, `${userName}.creations.json`)
  let cache
  if (fs.existsSync(cacheName)) {
    const buf = fs.readFileSync(cacheName)
    cache = JSON.parse(buf)
  } else {
    cache = {}
  }
  for (const doc of docArray) {
    if (doc.id) {
      cache[doc.id] = 1
    } else {
      console.error('Invalid doc: no ID, cannot cache')
    }
  }
  // backup
  fs.renameSync(cacheName, cacheName + '.bak') // silently replaces any existing backup
  // save updated cache
  return fs.promises.writeFile(cacheName, JSON.stringify(cache))
}

module.exports = {
  isMatch,
  sourceToCreation,
  getJobs,
  getSeries,
  filterNewCreations,
  omitOwnCreations,
  registerAsDownloaded,
  getCreationCache,
  getUserName,
  registerAsLiked,
}
