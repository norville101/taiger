const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { setTimeout } = require('node:timers/promises')
const { PARAM } = require('../mdparams')
const { RemoteImageFile } = require('../image')
const { GetUrlFilename } = require('../utils')
const { NovitaSDK, TaskStatus } = require('novita-sdk')

// const stateDir = path.join(__dirname, '..', 'state', 'novita')
const configPath = path.join(__dirname, '..', 'config', 'novita.json')
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  : { apiKey: '' }
const novitaClient = new NovitaSDK(config.apikey)

const headers = {
  'content-type': 'application/json',
  'authorization': `Bearer ${config.apikey}`,
}

function isMatch (source) {
  return source.images && source.source === 'Novita'
}
exports.isMatch = isMatch

async function sourceToCreation (source, creation, options) {
  creation.createdBy = 'Novita'
  creation.id = source.task.task_id
  creation.orderById = false // which means a time-based prefix will be added and title omitted from filename
  let debug_request
  const debug_info = source.extra?.debug_info
  if (debug_info) {
    // "submit_time_ms": "1729550395843",
    // "execute_time_ms": "1729550395881",
    // "complete_time_ms": "1729550416180"
    creation.createdAt = new Date(parseFloat(debug_info.complete_time_ms))
    if (debug_info.request_info) {
      debug_request = JSON.parse(debug_info.request_info)
      if (debug_request.prompts && debug_request.prompts.length > 1) {
        console.log('ATTENTION... multiple prompts out when only one given?')
        console.log(debug_request.prompts)
      }
      // if (debug_request.seeds.length !== debug_request.num_images_per_prompt) {
      //   console.log('WARNING... seeds array does not seem to work like you expected it to?')
      //   console.log(`  ${debug_request.seeds.length} !== ${debug_request.num_images_per_prompt}`)
      // } // it doesn't match... seeds always has only one seed.. need to figure out
    }
  }
  creation.prompt = source.request.prompt
  if (source.request.negative_prompt)
    creation.negativePrompt = source.request.negative_prompt
  // todo: support img2img
  // creation.sourceImageId = source.evolvedFrom
  // creation.sourceImageUrl = base_image_url + source.startImage.path
  creation.setParam(PARAM.steps, source.request.steps)
  if (source.request.sampler_name)
    creation.setParam(PARAM.sampler, source.request.sampler_name)
  if (source.request.guidance_scale)
    creation.setParam(PARAM.cfgScale, source.request.guidance_scale) // CFG (Classifier Free Guidance) scale: min 1, max 30
  let seed = source?.extra?.seed || source.request.seed || debug_request?.seeds[0]
  if (seed)
    creation.setParam(PARAM.seed, seed) // see also debug_request.seeds[]
  creation.setParam(PARAM.size, `${source.request.width}x${source.request.height}`)
  if (source.request.model_name)
    creation.setParam(PARAM.model, source.request.model_name)
  if (source.request.refiner) {
    throw new Error('refiner not implemented')
    creation.setParam('Refiner', source.request.refiner)
  }
  if (source.request.hires_fix) {
    throw new Error('hires_fix not implemented')
    creation.setParam(PARAM.upscale, '???')
  }
  creation.setParam('Service', creation.createdBy)
  if (!creation.images) {
    creation.images = []
  }
  if (source.images && source.images.length > 0) {
    source.images.forEach((img, i) => {
      const outputUrl = img.image_url
      const urlExt = '.' + img.image_type
      const imgName = path.basename(GetUrlFilename(img.image_url), urlExt)
      const newImg = new RemoteImageFile(outputUrl, urlExt)
      newImg._orig_meta = img
      // newImg.fnPrefix = creation.timePrefix + ' ' + creation.id // no op
      newImg.reelName = creation.id
      newImg.imageNumber = i + 1
      newImg.fnImageNum = (i + 1).toString()
      newImg.uniqueId = imgName
      newImg.createdAt = new Date(creation.createdAt)
      if (debug_request?.seeds?.[i]) {
        newImg.seedOverride = debug_request?.seeds?.[i]
      }
      creation.images.push(newImg)
    })
  }
}
exports.sourceToCreation = sourceToCreation

function propNum (obj, propName, int) {
  if (propName in obj) {
    const curVal = obj[propName]
    if (typeof curVal !== 'number') {
      if (curVal) {
        obj[propName] = int ? parseInt(curVal) : parseFloat(curVal)
      } else { // falsy
        delete obj[propName]
      }
    }
  }
}

function propBool (obj, propName) {
  if (propName in obj) {
    let curVal = obj[propName]
    if (typeof curVal !== 'boolean') {
      if (typeof curVal === 'string') curVal = curVal.toLowerCase()
      if (curVal === 'on' || curVal === 'yes' || curVal === 'true' || curVal === 1) {
        obj[propName] = true
      } else { // falsy
        delete obj[propName]
      }
    }
  }
}

function typeCheck (req) {
  propNum(req, 'width', true)
  propNum(req, 'height', true)
  propNum(req, 'image_num', true)
  propNum(req, 'steps', true)
  propNum(req, 'gruidance_scale', false)
  propNum(req, 'seed', true)
  propNum(req, 'clip_skip', true)
  propBool(req, 'enable_transparent_background')
  propBool(req, 'restore_faces')
  if (req.lora_name_0) {
    if (!req.loras || !Array.isArray(req.loras)) {
      req.loras = []
    }
    req.loras.push({
      model_name: req.lora_name_0,
      strength: req.lora_strength_0 || 1.0,
    })
    delete req.lora_name_0
    delete req.lora_strength_0
  }
  if (req.loras) {
    req.loras.forEach(lora => propNum(lora, 'strength', false))
  }
}

async function txt2img (req) {
  if (['flux-1-schnell', 'flux-1-dev', 'flux-1-dev-lora'].includes(req.model_name)) {
    return flux1beta(req, req.model_name)
  }
  typeCheck(req)
  if (!req.width && !req.height) {
    req.width = 512
    req.height = 512
  }
  if (!req.sampler_name) req.sampler_name = "DPM++ 2M Karras"
  if (!req.guidance_scale) req.guidance_scale = 7
  if (!req.steps) req.steps = 20
  if (!req.image_num) req.image_num = 1
  if (!req.seed) req.seed = -1
  const novRequest = {
    request: req,
  }
  const novResponse = await novitaClient.txt2Img(novRequest)
  const taskId = novResponse.task_id
  console.log(`Waiting for Novita task ${taskId}`)
  const taskResult = await pollTaskStatus(taskId)
  return {
    ...taskResult,
    source: 'Novita',
    request: req,
  }
}
exports.txt2img = txt2img

async function flux1beta (req, modelName) {
  typeCheck(req)
  if (req.loras && modelName === 'flux-1-dev') { // Unfortunately Novita is DEPRECATING flux-1-dev
    modelName = 'flux-1-dev-lora' // AND flux-1-dev-lora... neither will work after 2024-12-31. :-(
  }
  const url = `https://api.novita.ai/v3beta/${modelName}`
  const defaultSteps = (modelName === 'flux-1-schnell') ? 4 : 20
  const data = {
    response_image_type: 'png',
    prompt: req.prompt,
    seed: req.seed >= 0 ? req.seed : Math.random()*2**32>>>0,
    steps: req.steps || defaultSteps,
    width: req.width || 512,
    height: req.height || 512,
    image_num: req.image_num || 1,
  }
  if (req.loras && Array.isArray(req.loras)) {
    data.loras = req.loras
  }
  const response = await axios({
    method: 'post',
    maxBodyLength: Infinity,
    url,
    headers,
    data,
  })
  const taskResult = response.data
  data.model_name = modelName
  return {
    extra: {
      debug_info: {
        complete_time_ms: (new Date()).valueOf().toString()
      }
    },
    ...taskResult,
    endpoint: `/v3beta/${modelName}`,
    source: 'Novita',
    request: data,
  }
}
exports.flux1beta = flux1beta

/////////////////////////////
// Novita utils

async function pollTaskStatus(taskId) {
  const poll = async () => {
    const progress = await novitaClient.progress({ task_id: taskId })
    console.log(`task ${progress.task.task_id} status: ${progress.task.status}, ${progress.task.progress_percent}% (ETA ${progress.task.eta})`)
    if (progress.task.status === TaskStatus.SUCCEED) {
      return progress
    } else if (progress.task.status === TaskStatus.FAILED) {
      return progress
    } else {
      await setTimeout(1000)
    }
  }

  let result
  while (!result) {
    result = await poll()
  }
  return result
}

// return from txt2img looks like this:
/*
{
  "request": {
    "model_name": "",
    "prompt": "",
    "negative_prompt": "",
    "sampler_name": "",
    "steps": 20,
    "seed": -1,
    "width": 0,
    "height": 0,
    "guidance_scale": 7,
    "image_num": 4,
    "enable_transparent_background": false,
    "restore_faces": false,
    // "sd_vae": ?,
    // "loras": ?,
    // "embeddings": ?,
    // "hires_fix": ?,
    // "refiner": ?,
  },
  "extra": {
    "seed": "1492899925",
    "enable_nsfw_detection": false,
    "debug_info": {
        "request_info": "{\"model\":\"beautypromix_v1.safetensors\",\"prompts\":[\"Surreal tarot art, impasto, gauche, lace and paper quilling. esoteric abstract elements and visible brush strokes. Mixed media collage with real succulents. Whimsical textures, Tachisme Dynamic Brushwork, perfect composition, rule of thirds, 8k, hyperdetailed, gold and opal elements, visually captivating, delicate, concept art, fine art, whimsical, Masterpiece, Ghibli, Richard Burlet, Soft and Dreamy Hues\"],\"negative_prompts\":[\"\"],\"seeds\":[1492899925],\"height\":512,\"width\":512,\"guidance_scale\":7,\"num_images_per_prompt\":1,\"num_inference_steps\":20,\"sampler_name\":\"DPM++ 2M Karras\"}",
        (parsed): {
          "model": "beautypromix_v1.safetensors",
          "prompts": ["Surreal tarot art, impasto, gauche, lace and paper quilling. esoteric abstract elements and visible brush strokes. Mixed media collage with real succulents. Whimsical textures, Tachisme Dynamic Brushwork, perfect composition, rule of thirds, 8k, hyperdetailed, gold and opal elements, visually captivating, delicate, concept art, fine art, whimsical, Masterpiece, Ghibli, Richard Burlet, Soft and Dreamy Hues"],
          "negative_prompts": [""],
          "seeds": [1492899925],
          "height": 512,
          "width": 512,
          "guidance_scale": 7,
          "num_images_per_prompt": 1,
          "num_inference_steps": 20,
          "sampler_name": "DPM++ 2M Karras"
        }
        "submit_time_ms": "1729550395843",
        "execute_time_ms": "1729550395881",
        "complete_time_ms": "1729550416180"
    }
},
"task": {
    "task_id": "b7855daf-bffd-49a8-92a9-c6fdbbf55e7b",
    "task_type": "TXT_TO_IMG",
    "status": "TASK_STATUS_SUCCEED",
    "reason": "",
    "eta": 0,
    "progress_percent": 100
},
"images": [
    {
        "image_url": "https://faas-output-image.s3.ap-southeast-1.amazonaws.com/prod/b7855daf-bffd-49a8-92a9-c6fdbbf55e7b/9589f747bd494109903dd2606dfbf943.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIASVPYCN6LRCW3SOUV%2F20241021%2Fap-southeast-1%2Fs3%2Faws4_request&X-Amz-Date=20241021T224350Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&x-id=GetObject&X-Amz-Signature=729ff88ed0993951e53ae1cca14df8e9859f9a04ec7cc2e45c39990e3ec9d078",
        "image_url_ttl": "3600",
        "image_type": "png",
        "nsfw_detection_result": null
    }
],
"videos": [],
"audios": []
}
*/
