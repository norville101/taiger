const axios = require('axios')
const fs = require('fs')
const path = require('path')
const { PARAM, MDParams } = require('../mdparams')
const { RemoteImageFile } = require('../image')

const stateDir = path.join(__dirname, '..', 'state', 'civitai')
const configPath = path.join(__dirname, '..', 'config', 'civitai.json')
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  : { headers: {} }
const cacheName = path.join(stateDir, 'models.cache.json')
let cache
if (fs.existsSync(cacheName)) {
  const str = fs.readFileSync(cacheName)
  cache = JSON.parse(str)
} else {
  cache = {}
}

function isMatch (source) {
  let result = Boolean(source.status && source.params && source.resources && source.baseModel) // old
  if (!result) {
    result = source.status && Array.isArray(source.steps) && source.steps.length > 0
      && source.steps[0].params && source.steps[0].resources
  }
  return result
  // source.status usually === 'Succeeded' but it can also be 'Error' and still have images to download!
}

async function sourceToCreation (source, creation) {
  creation.createdBy = 'Civitai'
  creation.id = source.id
  creation.orderById = false // which means a time-based prefix will be added and title omitted from filename
  creation.createdAt = new Date(source.createdAt)
  // check for new vs. old source format
  if (!source.params && Array.isArray(source.steps)) {
    source = source.steps[0]
  }
  let resources
  if (source.resources) {
    resources = source.resources.map(r => {
      const obj = {
        id: r.id,
        name: getModelFullName(r),
        type: (r.modelType || r.type).toLowerCase(),
      }
      if (r.strength) {
        obj.weight = r.strength
      }
      return obj
    })
  }
  const sourceMeta = source.params
  const outputFileCount = sourceMeta.quantity || source.quantity
  // prompt
  creation.prompt = sourceMeta.prompt
  // negative prompt
  if (sourceMeta.negativePrompt) creation.negativePrompt = sourceMeta.negativePrompt
  // todo: source image??  does civitai have any kind of image2image?
  // other parameters
  creation.setParam(PARAM.steps, sourceMeta.steps)
  if (sourceMeta.sampler || sourceMeta.scheduler) {
    creation.setParam(PARAM.sampler, sourceMeta.sampler || sourceMeta.scheduler)
  }
  if (sourceMeta.cfgScale) {
    creation.setParam(PARAM.cfgScale, sourceMeta.cfgScale) // CFG (Classifier Free Guidance) scale: min 1, max 30
  }
  if (sourceMeta.seed) {
    creation.setParam(PARAM.seed, sourceMeta.seed)
  } else if (outputFileCount > 0 && source.images.length > 0 && source.images[0].seed) {
    creation.setParam(PARAM.seed, source.images[0].seed)
  }
  if (sourceMeta.width && sourceMeta.height) {
    creation.setParam(PARAM.size, `${sourceMeta.width}x${sourceMeta.height}`)
  }
  if (source.model) { // old only, I believe
    const modelInfo = getModelInfoLocal(source.model, source.resources)
    if (modelInfo.modelHash) {
      creation.setParam(PARAM.modelHash, modelInfo.modelHash)
    } else if (source.modelHash) {
      creation.setParam(PARAM.modelHash, source.modelHash)
    }
    creation.setParam(PARAM.model, modelInfo.modelName)
  } else if (resources) { // new
    const model = resources.find(r => r.type == 'checkpoint')
    creation.setParam(PARAM.model, model.name)
  }
  if (sourceMeta.clipSkip) {
    creation.setParam(PARAM.clipSkip, sourceMeta.clipSkip)
  }
  const loraUses = resources.filter(r => r.type === 'lora')
  if (loraUses.length > 0) {
    const loraHashes = new MDParams()
    for (const loraUse of loraUses) {
      loraHashes.setParam(loraUse.name, '0')
    }
    creation.setParam(PARAM.loraHashes, loraHashes)
  }
  if (resources) {
    const civitaiResources = resources.map(r => {
      const obj = { type: r.type }
      if (r.weight) obj.weight = r.weight
      obj.modelVersionId = r.id
      return obj
    })
    creation.setParam('Civitai resources', civitaiResources)
  }
  creation.images = []
  source.images.forEach((img, index) => {
    const newImg = new RemoteImageFile(img.url, '.jpg', config.headers)
    newImg.createdAt = new Date(img.completed || creation.createdAt)
    newImg.uniqueId = img.id
    newImg.reelName = img.requestId || creation.id
    if (outputFileCount > 1) {
      newImg.imageNumber = index + 1
      newImg.fnImageNum = String(newImg.imageNumber)
    }
    newImg.fnPrefix = newImg.reelName // no op
    newImg.seedOverride = img.seed
    creation.images.push(newImg)
  })
}

function getModelInfoLocal (idStr, resources) {
  let modelId, model, modelName, modelHash
  if (
    idStr.toLowerCase().startsWith('@civitai/')
    && (modelId = Number.parseInt(idStr.substring(9)))
    && (model = resources.find(r => r.id == modelId))
  ) {
    modelName = getModelFullName(model)
  } else {
    modelName = source.model
  }
  modelHash = 0 // not included in what we have locally
  return { modelName, modelHash }
}

function getModelFullName (model) {
  const part1 = model.modelName || ''
  const part2 = model.name || ''
  return part1 + (part1 && part2 ? ' ' : '') + part2
}

async function fetchModelByHash (hash) {
  const response = await axios({
    url: `https://civitai.com/api/v1/model-versions/by-hash/${hash}`,
    method: 'GET',
    //headers: config.headers, // not needed
  })
  return response.data
}

async function fetchModelByModelVersionId (id) {
  const response = await axios({
    url: `https://civitai.com/api/v1/model-versions/${id}`,
    method: 'GET',
    //headers: config.headers, // not needed
  })
  return response.data
}

module.exports = {
  isMatch,
  sourceToCreation,
  fetchModelByHash,
  fetchModelByModelVersionId,
}
