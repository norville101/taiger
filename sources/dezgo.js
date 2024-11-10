const path = require('path')
const fs = require('fs')
const axios = require('axios')
const { RemoteImageFile } = require('../image')
const { fetchModelByHash } = require('./civitai')
const { PARAM, MDParams } = require('../mdparams')
const fsp = fs.promises

const stateDir = path.join(__dirname, '..', 'state', 'dezgo')
const configPath = path.join(__dirname, '..', 'config', 'dezgo.json')
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
  return Boolean(source._id && source.meta && source.type === 'job' && source.meta['file.output'])
}

async function sourceToCreation (source, creation) {
  creation.createdBy = 'Dezgo'
  const inputLoc = source.meta['file.input']
  creation.id = inputLoc.split('/')[0]
  creation.orderById = false // which means a time-based prefix will be added and title omitted from filename
  // creation.idShort = creation.id.substr(0, 8) + creation.id.substr(9, 2)
  creation.createdAt = new Date(source.time)
  if (source.meta['job.function']) {
    creation.jobType = source.meta['job.function']
    // job types/functions include: 'text2image_sdxl', 'text2image', 'controlnet',
    // 'image2image', 'upscale', 'text-inpainting', 'edit-image'
  }
  const inputResponse = await axios({
    url: `https://api.dezgo.com/account/file?id=${inputLoc}`,
    headers: config.headers,
    responseType: 'json',
  })
  const inputMeta = Object.entries(inputResponse.data).reduce((accumulator, current) => {
    accumulator[current[0]] = current[1].Value
    return accumulator
  }, {})
  source.input = inputMeta
  if (creation.jobType === 'upscale') { // lack of metadata :(
    if (inputMeta.image) {
      creation.sourceImageBase64 = inputMeta.image
      delete inputMeta.image
    }
  } else { // not 'upscale' -- metadata available :)
    // prompt
    if (creation.jobType === 'text-inpainting') {
      creation.prompt = `${inputMeta.prompt} | Inpainting mask: ${inputMeta.mask_prompt}`
    } else {
      creation.prompt = inputMeta.prompt
    }
    // negative prompt
    if (inputMeta.negative_prompt) creation.negativePrompt = inputMeta.negative_prompt
    // source image
    if (inputMeta.init_image) {
      creation.sourceImageBase64 = inputMeta.init_image
      delete inputMeta.init_image
      if (inputMeta.strength) creation.sourceImageStrength = inputMeta.strength // only 'image2image'
      if (inputMeta.image_guidance) creation.sourceImageGuidance = inputMeta.image_guidance // only 'edit-image'
    }
    creation.setParam(PARAM.steps, inputMeta.steps)
    if (inputMeta.sampler) {
      creation.setParam(PARAM.sampler, inputMeta.sampler)
    }
    if (inputMeta.guidance) {
      creation.setParam(PARAM.cfgScale, inputMeta.guidance) // CFG (Classifier Free Guidance) scale: min 1, max 30
    }
    if (inputMeta.seed) {
      creation.setParam(PARAM.seed, inputMeta.seed)
    }
    if (inputMeta.width && inputMeta.height) {
      creation.setParam(PARAM.size, `${inputMeta.width}x${inputMeta.height}`)
    }
    if (inputMeta.model) {
      creation.setParam(PARAM.model, inputMeta.model)
    } else if (creation.jobType === 'edit-image') {
      creation.setParam(PARAM.model, 'InstructPix2Pix')
    }
    if (typeof inputMeta.refiner !== 'undefined') {
      creation.setParam('Refiner', inputMeta.refiner)
    }
    if (inputMeta.upscale > 1) {
      creation.setParam(PARAM.upscale, inputMeta.upscale)
    }

    if (inputMeta.lora1) {
      creation.loras = []
      let loraUsage = {
        id: inputMeta.lora1,
        weight: inputMeta.lora1_strength,
        model: await getModelInfo(inputMeta.lora1),
      }
      creation.loras.push(loraUsage)
      if (inputMeta.lora2) {
        loraUsage = {
          id: inputMeta.lora2,
          weight: inputMeta.lora2_strength,
          model: await getModelInfo(inputMeta.lora2),
        }
        creation.loras.push(loraUsage)
      }
      const loraHashes = new MDParams()
      for (const lora of creation.loras) {
        loraHashes.setParam(lora.model && lora.model.name || 'unknown', lora.id)
      }
      creation.setParam(PARAM.loraHashes, loraHashes)
    }
  }
  const outputFileCount = Number(source.meta['file.output.count'])
  const outputLoc = source.meta['file.output']
  creation.images = []
  for (var i = 0; i < outputFileCount; i++) {
    const newImg = new RemoteImageFile(
      `https://api.dezgo.com/account/file?id=${outputLoc}&offset=${i}`,
      '.' + (inputMeta.format || 'png'),
      config.headers,
    )
    newImg.createdAt = new Date(creation.createdAt)
    newImg.reelName = creation.id
    newImg.uniqueId = `${creation.id}/${i}`
    if (outputFileCount > 1) {
      newImg.imageNumber = i + 1
      newImg.fnImageNum = String(newImg.imageNumber)
    }
    // newImg.fnPrefix = creation.idShort // no op
    if (creation.jobType === 'upscale') {
      newImg.fnScale = '2'
    }
    if (inputMeta.seed) {
      newImg.seedOverride = inputMeta.seed + i
    }
    creation.images.push(newImg)
  }
}

async function extendCreation (input, creation) {
  if (!creation.prompt) {
    creation.prompt = input.prompt
  }
  if (input.negative_prompt && !creation.negativePrompt) {
    creation.negativePrompt = input.negative_prompt
  }
  if (input.mask_prompt && !creation.maskPrompt) { // && creation.jobType === 'text-inpainting'
    creation.maskPrompt = input.mask_prompt
  }
  if (!creation.getParam(PARAM.steps)) {
    creation.setParam(PARAM.steps, input.steps)
  }
  if (!creation.getParam(PARAM.size)) {
    creation.setParam(PARAM.size, `${input.width}x${input.height}`)
  }
  if (!creation.getParam(PARAM.seed)) {
    creation.setParam(PARAM.seed, input.seed)
  }
  //creation.setParam(PARAM.method, creation.method)
  if (!creation.getParam(PARAM.model)) {
    creation.setParam(PARAM.model, input.model)
  }
  if (!creation.getParam(PARAM.sampler)) {
    creation.setParam(PARAM.sampler, input.sampler)
  }
  if (!creation.getParam(PARAM.cfgScale)) {
    creation.setParam(PARAM.cfgScale, input.guidance) // CFG (Classifier Free Guidance) scale: min 1, max 30
  }
  if (input.lora1 && !creation.getParam(PARAM.loraHashes)) {
    creation.loras = []
    let loraUsage = {
      id: input.lora1,
      weight: input.lora1_strength,
      model: await getModelInfo(input.lora1),
    }
    creation.loras.push(loraUsage)
    if (input.lora2) {
      loraUsage = {
        id: input.lora2,
        weight: input.lora2_strength,
        model: await getModelInfo(input.lora2),
      }
      loras.push(input.lora2)
    }
    const loraHashes = new MDParams()
    for (const lora of creation.loras) {
      loraHashes.setParam(lora.model && lora.model.name || 'unknown', lora.id)
    }
    creation.setParam(PARAM.loraHashes, loraHashes)
  }
  if (input.upscale > 1 && !creation.getParam(PARAM.upscale)) {
    creation.setParam(PARAM.upscale, input.upscale)
  }
}

async function getModelInfo (sha256) {
  let result = cache[sha256]
  if (!result) {
    const info = await fetchModelByHash(sha256)
    if (info) {
      result = {
        name: info.model.name + ' ' + info.name,
        type: info.model.type,
        baseModel: info.baseModel,
        modelId: info.modelId,
        modelVersionId: info.id,
      }
      // cache[modelId] = {
      //   name: result.name,
      //   type: result.type,
      //   author: result.author,
      //   modelProvider: result.modelProvider,
      //   externalId: result.externalId,
      //   activeVersion: result.activeVersion && {
      //     id: result.activeVersion.id,
      //     name: result.activeVersion.name,
      //     baseModel: result.activeVersion.baseModel,
      //     createdAt: result.activeVersion.createdAt,
      //     externalId: result.activeVersion.externalId,
      //     downloadUrl: result.activeVersion.downloadUrl,
      //   },
      //   modelCheckpointFilename: result.modelCheckpointFilename,
      //   createdAt: result.createdAt,
      //   tags: result.tags,
      //   trainedWords: result.trainedWords,
      // }
      cache[sha256] = result
      await fsp.writeFile(cacheName, JSON.stringify(cache))
    }
  }
  return result
}

module.exports = {
  isMatch,
  sourceToCreation,
}

/* example top-level metadata, similar (more or less) independent of job type:
{
    "_id": "e05b169c-8bff-2b1f-0448-699dead44275",
    "userId": "4395bd00-975f-b593-791a-aa509db85dc6",
    "amount": -0.0150,
    "time": "2023-11-08T05:22:53.569Z",
    "type": "job",
    "meta": {
        "job.function": "text2image_sdxl",
        "apiKey.label": "magic link",
        "job.input.model": "juggernautxl_1024px", // present for 'tet2image_sdxl', 'text2image', 'controlnet', 'image2image', 'text-inpainting'
        "job.input.control_model": "openpose_full", // present only for 'controlnet'
        "file.input": "4c2e4fe7-7036-4805-86b5-7e75f4b61f03/input",
        "file.output": "4c2e4fe7-7036-4805-86b5-7e75f4b61f03/output",
        "file.output.count": "2"
    },
    "credits": 10,
    "debits": 5.7271,
    "balance": 4.2729,
    "index": 673
},
*/

/* example metadata returned from each job type:

text2image_sdxl: {
	"prompt": "...",
	"model": "juggernautxl_1024px",
	"count": 2,
	"refiner": true,
	"width": 832,
	"height": 1216,
	"negative_prompt": "...",
	"guidance": 7.0,
	"steps": 30,
	"sampler": "auto",
	"seed": 3644259088,
	"format": "png"
}

text2image: {
	"width": 416,
	"height": 608,
	"prompt": "...",
	"model": "icbinp",
	"count": 4,
	"negative_prompt": "...",
	"guidance": 7.0,
	"steps": 30,
	"sampler": "dpmpp_2m_karras",
	"seed": 739786821,
	"upscale": 1,
	"lora1": "82E7578994BE9CBF305606DEADAEEA05D3A86EDB79C690B1F4A47285C057A7CB",
	"lora1_strength": 1.0,
	"lora2_strength": 0.7,
	"format": "png"
}

controlnet: {
	"width": 416,
	"height": 608,
	"prompt": "...",
	"control_model": "openpose_full",
	"control_scale": 1.0,
	"control_preprocess": true, // means init_image needed to be (and was) pre-processed before being used with openpose
	"init_image": "iVBORw0KGgoA...",
	"model": "dreamshaper_8",
	"count": 2,
	"negative_prompt": "...",
	"guidance": 7.0,
	"steps": 30,
	"sampler": "dpmpp_2m_karras",
	"seed": 3692593873,
	"upscale": 1,
	"lora1_strength": 0.7,
	"lora2_strength": 0.7,
	"format": "png"
}

image2image: {
	"prompt": "...",
	"strength": 0.75,
	"init_image": "iVBORw0KGgoAAAAN...",
	"model": "dreamshaper_8",
	"count": 2,
	"negative_prompt": "...",
	"guidance": 7.0,
	"steps": 30,
	"sampler": "dpmpp_2m_karras",
	"seed": 713151315,
	"upscale": 1,
	"lora1_strength": 0.7,
	"lora2_strength": 0.7,
	"format": "png"
}

upscale: { // Dezgo's upscale is always a factor of 2, so treat that as a default?
	"image": "iVBORw0KGgoAAAANSUhEUgAAA...",
	"format": "png"
}

text-inpainting: {
	"mask_prompt": "...",
	"prompt": "...",
	"init_image": "iVBORw0KGgoAAAANSUhE...",
	"model": "cyberrealistic_3_3_inpaint",
	"count": 2,
	"negative_prompt": "...",
	"guidance": 7.0,
	"steps": 30,
	"sampler": "euler",
	"seed": 2260269734,
	"upscale": 1,
	"format": "png"
}

edit-image:{
	"prompt": "...",
	"init_image": "iVBORw0KGgoAAAANSUhEUgAAAQQAAA...",
	"image_guidance": 1.3,
	"count": 2,
	"negative_prompt": "...",
	"guidance": 7.0,
	"steps": 30,
	"sampler": "dpmpp_2m_karras",
	"seed": 59019797,
	"upscale": 1,
	"format": "png"
}

*/