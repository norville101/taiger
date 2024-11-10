const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { PARAM, MDParams } = require('../mdparams')
const { RemoteImageFile } = require('../image')
const {
  GetFilenameSuffix,
  GetFilenameExtension,
  GetUrlExtension,
  GetUrlFilename,
  StrToNum,
} = require('../utils')

const stateDir = path.join(__dirname, '..', 'state', 'happyaccidents')
const cacheName = path.join(stateDir, 'models.cache.json')
let cache
if (fs.existsSync(cacheName)) {
  const str = fs.readFileSync(cacheName)
  cache = JSON.parse(str)
} else {
  cache = {}
}

const headers = {
  'referer': 'https://www.happyaccidents.ai/',
  'origin': 'https://www.happyaccidents.ai',
  'dnt': 1,
  'authority': 'easel-fgiw.onrender.com',
}

async function fetchModelInfo (modelId) {
  const config = {
    url: `https://easel-fgiw.onrender.com/v1/models/metadata-items/${modelId}`,
    method: 'GET',
    headers
  }
  const response = await axios(config)
  return response.data
}

async function getModelInfo (modelId) {
  let result = cache[modelId]
  if (!result) {
    result = await fetchModelInfo(modelId)
    if (result) {
      cache[modelId] = {
        name: result.name,
        type: result.type,
        author: result.author,
        modelProvider: result.modelProvider,
        externalId: result.externalId,
        activeVersion: result.activeVersion && {
          id: result.activeVersion.id,
          name: result.activeVersion.name,
          baseModel: result.activeVersion.baseModel,
          createdAt: result.activeVersion.createdAt,
          externalId: result.activeVersion.externalId,
          downloadUrl: result.activeVersion.downloadUrl,
        },
        modelCheckpointFilename: result.modelCheckpointFilename,
        createdAt: result.createdAt,
        tags: result.tags,
        trainedWords: result.trainedWords,
      }
      await fs.promises.writeFile(cacheName, JSON.stringify(cache))
    }
  }
  return result
}

function isMatch (source) {
  return Boolean(source.inferenceId && source.inferencePayload)
}
exports.isMatch = isMatch

async function sourceToCreation (source, creation) {
  creation.id = source.inferenceId
  creation.orderById = false // which means a time-based prefix will be added and title omitted from filename
  // creation.idShort = creation.id.substr(0, 8) + creation.id.substr(9, 2)
  creation.createdBy = 'happyaccidents.ai'
  const hasImages = source.images && source.images.length > 0
  if (hasImages && source.images[0].createdAt) {
    creation.createdAt = new Date(source.images[0].createdAt)
  }
  const inference = source.inferencePayload
  if (inference) {
    creation.prompt = inference.prompt
    if (inference.negativePrompt) creation.negativePrompt = inference.negativePrompt
    if (inference.numInferenceSteps)
      creation.setParam(PARAM.steps, inference.numInferenceSteps)
    else // Steps value necessary for later parsing!
      creation.setParam(PARAM.steps, 'unknown')
    creation.setParam(PARAM.size, `${inference.outputWpx}x${inference.outputHpx}`)
    if (inference.seed) creation.setParam(PARAM.seed, inference.seed)
    if (inference.modelId) {
      creation.model = await getModelInfo(inference.modelId)
      const modelName = creation.model && creation.model.name
      if (modelName) creation.setParam(PARAM.model, modelName)
      else {
        console.log(`Warning: inference ${creation.id} uses unknown model ID ${inference.modelId}`)
        creation.setParam('Model ID', inference.modelId)
      }
    }
    if (inference.samplingMethod) creation.setParam(PARAM.sampler, inference.samplingMethod)
    if (inference.guidanceScale) creation.setParam(PARAM.cfgScale, inference.guidanceScale)
    if (inference.lora && inference.lora.length > 0) {
      creation.loras = []
      for (const lObj of inference.lora) {
        const loraUsage = {
          id: lObj.id,
          weight: lObj.weight,
          model: await getModelInfo(lObj.id),
        }
        creation.loras.push(loraUsage)
      }
      const loraHashes = new MDParams()
      for (const lora of creation.loras) {
        loraHashes.setParam(lora.model && lora.model.name || 'unknown', lora.id)
      }
      creation.setParam(PARAM.loraHashes, loraHashes)
    }
    if (inference.vae) creation.setParam(PARAM.vae, inference.vae)
    if (inference.clipSkip) creation.setParam(PARAM.clipSkip, inference.clipSkip)
    // todo: handle image-to-image, upscales, inpainting, etc.
    if (inference.imageUrl) creation.sourceImageUrl = inference.imageUrl
    if (inference.upscale > 1) {
      creation.setParam(PARAM.hiresUpscale, inference.upscale)
    }
    creation.setParam(PARAM.version, creation.createdBy)
    if (hasImages) {
      creation.images = []
      source.images.forEach(img => {
        const newImg = new RemoteImageFile(
          `https://ik.imagekit.io/hb42m9hh0/${img.folderPath}/${img.filename}`,
          GetFilenameExtension(img.filename),
        )
        newImg.uniqueId = img.id
        newImg.createdAt = new Date(img.createdAt)
        newImg.reelName = img.inferenceJobId
        newImg.imageNumber = StrToNum(GetFilenameSuffix(img.filename), 1)
        newImg.fnImageNum = String(newImg.imageNumber)
        // newImg.fnPrefix = creation.idShort // no op
        creation.images.push(newImg)
      })
    }
  }
}
exports.sourceToCreation = sourceToCreation
