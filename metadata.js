const path = require('path')
const {
  Base32,
  EscapeFileName,
  FormatLocalDateTimeANTZ,
  FormatLocalDateTimeZone,
  FormatLocalDateTimeISO,
  GetUrlExtension,
  GetUrlFilename,
  GetFilenameExtension,
  GetFilenameSuffix,
} = require('./utils')

const PARAM = {
  steps: 'Steps',
  size: 'Size',
  seed: 'Seed',
  method: 'Method',
  model: 'Model',
  sampler: 'Sampler',
  cfgScale: 'CFG scale',
  loraSha256: 'Lora SHA256',
  loraStrength: 'Lora strength',
  vae: 'VAE',
  clipSkip: 'Clip skip', // applicable only in sd1.x, not sdxl
  upscale: 'Hires upscale',
  upscaler: 'Hires upscaler',
  denoise: 'Denoising strength', // applicable only in img2img!
}

const unstaparam = {
  aspect_ratio: 'Aspect Ratio',
  lighting_filter: 'Sampler',
    'chaotic-composition': 'Diverse Composition',
    'dynamic-contrast': 'Dynamic Contrast',
    'complementary-compositon': 'Complementary Composition',
    'color-guidance': 'Color Guidance',
    'dual-color-guidance': 'Dual Color Guidance',
      lighting_filter_color: 'Lighting Color',
      lighting_filter_negative_color: 'Negative Lighting Color',
      alternate_mode: 'Flat Background',
  lighting_filter_strength: 'Sampler Strength',
  detail_pass_strength: 'High Frequency Detail',
  saturation: 'Saturation',
}

const haModels = {
  'c42bee6216b04ea59ea6b8307bc471f1': 'ForgottenMix - Cartoon 2.5D (v1.0)',
  '17acb86b7bdb49d78ea0c18b0ceeb0e6': 'epiCRealism (Natural Sin)',
  '67d8dde17c9c4c5a9134d2b61d9edbe2': 'ICBINP - "I Can\'t Believe It\'s Not Photography" ()',
  'faa11c18ac9f4884813b7cc25739b8fe': 'AbsoluteReality (v1.8.1)',
  'c9520bf24f614ce7acc63f95a1952d32': 'Uber Realistic Porn Merge (URPM) (UPRMv1.3)',
  'cce284f69ded42408e48a51ef177c971': 'epiCRealism (Natural Sin RC1 VAE)',
  'cb2af481971142498d9240f6c4b3ebba': 'CyberRealistic (v3.3)',
}
const haLoras = {
  '8885e2e867ad41a28f8425a6bc552c75': 'MS Real Lite - POV Pussy from Below LoRA (v1.0)',
  '00d1ce7b4d6c4bf18052e80d3dab4049': 'POV Doggy Anal + Creampie LoRA (v3)',
  '9c0e576286534457b5c26c961542524a': 'Redo of POVBJer (v3)',
}

class SDMetadata {
  constructor (source) {
    if (source && typeof source === 'object') {
      this.params = []
      if (source.sender === 'starRycover' || source.__typename === 'Creation' || source.__typename === 'publicCreation') { // starryAI metadata
        this.initFromStarryAI(source)
      } else if (source._id && source.meta && source.type === 'job' && source.meta['file.output']) {
        this.initFromDezgoApi(source)
      } else if (source.inferenceId && source.inferencePayload) {
        this.initFromHappyAccidents(source)
      } else if (source.image_info && source.images && source.image_info.lighting_filter) {
        this.initFromUnstabilityAI(source)
      } else if (source.metadata && source.model_version && source.metadata.model_version && source.blurhash) {
        this.initFromMageSpace(source)
      } else if (source.status && source.params && source.resources && (source.baseModel || source.params.baseModel)) {
        this.initFromCivitai(source)
      }
    } else if (typeof source === 'string') {
      // maybe it's extracted from a PNG in 3-line format? try parsing that.
    }
  }

  get timeCode () {
    // Subtract timestamp for 1 Jan 2020, because no need to encode dates prior to that time.
    // Dates prior to 23 Jan 2021 require fewer than 6 base-32 digits, which is fine because no need for them either.
    // 6-digit date stamps cover the time period between 23 Jan 2021 - 9 Jan 2054
    // at a resolution of 1 second.
    return Base32.encode(Math.trunc(this.createdAt.valueOf()/1000) - 1577862000)
  }

  get uniqueId () {
    if (false && this.createdAt) return this.timeCode
    return this.idShort || this.id
  }

  get fnTitle () {
    return this.title
      ? EscapeFileName(this.title.substring(0, 48).trim())
      : this.prompt
        ? EscapeFileName(this.prompt.substring(0, 48).trim())
        : undefined
  }

  get size () {
    if (this.width && this.height) {
      return this.width + 'x' + this.height
    }
  }

  get hasData () {
    return typeof this.prompt === 'string'
  }

  getVariationId (variation) {
    // starryAI:
    return variation.idShort || variation.id
  }

  getVariationExtension (variation, fallback = false) {
    // starryAI:
    return fallback ? variation.__ext_fallback : variation.__ext
  }

  getVariationUrl (variation, fallback = false) {
    return fallback ? variation.__url_fallback : variation.__url
  }

  addParam (name, value) {
    this.params.push([name, value])
  }

  initFromStarryAI (source) {
    this.createdBy = 'StarryAI'
    if (source.id) this.id = source.id
    if (source.width) this.width = source.width
    if (source.height) this.height = source.height
    if (source.createdAt) this.createdAt = new Date(source.createdAt)
    if (source.publishedAt) this.publishedAt = new Date(source.publishedAt)
    if (source.title) this.title = source.title
    if (source.link && source.link !== 'null') this.url = source.link
    if (source.prompts && source.prompts.length > 0) {
      this.prompts = source.prompts.map(p => {
        const { __typename, ...newPrompt } = p
        return newPrompt
      })
      const weighted = this.prompts.some(p => p.weight)
      // if weights are present, sort in descending order of weight;
      // otherwise assume positive first and negative last
      if (this.prompts.length > 1 && weighted) {
        this.prompts.sort((a, b) => (b.weight || 0) - (a.weight || 0))
      }
      this.prompt = this.prompts[0].prompt
      if (this.prompts.length > 1) {
        if (this.prompts.length === 2 || !weighted) {
          this.negativePrompt = this.prompts[1].prompt
        } else { // this.prompts.length > 2 && weighted
          this.negativePrompt = this.prompts[this.prompts.length - 1].prompt
        }
      }
    }
    if (source.prompt) {
      if (this.prompt) {
        if (this.prompt !== source.prompt) {
          console.error('Error: may have parsed prompts array incorrectly!')
        }
      } else {
        this.prompt = source.prompt
      }
    }
    if (source.negativePrompt) {
      if (this.negativePrompt) {
        if (this.negativePrompt !== source.negativePrompt) {
          console.error('Error: may have parsed prompts array incorrectly!')
        }
      } else {
        this.negativePrompt = source.negativePrompt
      }
    }
    if (!this.prompt && source.title) {
      this.prompt = source.title
    }
    if (source.initialImage) this.initialImage = source.initialImage

    if (source.iterations) this.addParam(PARAM.steps, source.iterations)
    if (this.size) this.addParam(PARAM.size, this.size)
    if (source.seed) this.addParam(PARAM.seed, source.seed)
    if (source.method) this.addParam(PARAM.method, 'StarryAI/' + source.method)
    if (source.model && source.modelName) {
      if (source.modelName.toLowerCase() === source.model.toLowerCase())
        this.addParam(PARAM.model, source.modelName)
      else
        this.addParam(PARAM.model, source.model + '/' + source.modelName)
    } else if (source.model) {
      this.addParam(PARAM.model, source.model)
    } else if (source.modelName) {
      this.addParam(PARAM.model, source.modelName)
    }

    if (source.variations && source.variations.length > 0) {
      this.variations = source.variations.map(v => {
        const newVar = {
          idShort: v.id,
          num: v.id.split('-')[1],
          seed: v.seed,
          url: v.url,
        }
        if (v.url) {
          newVar.__url = v.url
          const urlExt = GetUrlExtension(v.url)
          newVar.__ext = newVar.ext = urlExt || '.png'
          if (v.compressed) {
            newVar.__url_fallback = v.compressed
            const fn = GetUrlFilename(v.compressed)
            const compressedExt = path.extname(fn)
            newVar.id = path.basename(fn, compressedExt)
            newVar.__ext_fallback = compressedExt || '.webp'
          }
        } else if (v.compressed) {
          newVar.__url = newVar.url = v.compressed
          const fn = GetUrlFilename(v.compressed)
          const compressedExt = path.extname(fn)
          newVar.id = path.basename(fn, compressedExt)
          newVar.__ext = newVar.ext = compressedExt || '.webp'
        }
        return newVar
      })
    }
    if (source.upscales && source.upscales.length > 0) {
      this.upscales = source.upscales.map(oldUpscale => {
        const newUpscale = {}
        for (const [key, value] of Object.entries(oldUpscale)) {
          if (key === '__typename') continue
          if (key.endsWith('At') && typeof value === 'number') {
            newUpscale[key] = new Date(value)
          } else {
            newUpscale[key] = value
          }
        }
        return newUpscale
      })
    }
  }

  initFromDezgoApi (source) {
    this.method = 'Dezgo'
    this.jobId = source._id
    this.outputFile = source.meta['file.output']
    this.id = this.outputFile.split('/')[0]
    this.idShort = this.id.substr(0, 8) + this.id.substr(9, 2)
    this.createdAt = new Date(source.time)
    if (source.meta['job.function']) {
      this.jobType = source.meta['job.function']
    }
    this.outputFileCount = Number(source.meta['file.output.count'])
    this.variations = []
    for (var i = 0; i < this.outputFileCount; i++) {
      this.variations.push({
        idShort: this.idShort + '-' + i,
        __url: `https://api.dezgo.com/account/file?id=${this.outputFile}&offset=${i}`,
        __ext: '.png'
      })
    }
    if (source.Input) { // won't be true with new source; will be true if past source was read from disk
      this.extendFromDezgoEmbedded(source.Input)
    }
  }

  extendFromDezgoEmbedded (source) {
    if (source.Input) source = source.Input
    this.width = source.width
    this.height = source.height
    this.prompt = source.prompt
    this.negativePrompt = source.negative_prompt

    this.addParam(PARAM.steps, source.steps)
    this.addParam(PARAM.size, this.size)
    this.addParam(PARAM.seed, source.seed)
    this.addParam(PARAM.method, this.method)
    this.addParam(PARAM.model, source.model)
    this.addParam(PARAM.sampler, source.sampler)
    this.addParam(PARAM.cfgScale, source.guidance) // CFG (Classifier Free Guidance) scale: min 1, max 30
    if (source.lora1) {
      const loras = [source.lora1]
      const strengths = [source.lora1_strength]
      if (source.lora2) {
        loras.push(source.lora2)
        strengths.push(source.lora2_strength)
      }
      this.addParam(PARAM.loraSha256, loras)
      this.addParam(PARAM.loraStrength, strengths)
    }
    if (source.upscale > 1) {
      this.addParam(PARAM.upscale, source.upscale)
    }
  }

  initFromHappyAccidents (source) {
    this.createdBy = 'happyaccidents.ai'
    this.id = source.inferenceId
    this.idShort = this.id.substr(0, 8) + this.id.substr(9, 2)
    const hasImages = source.images && source.images.length > 0
    if (hasImages && source.images[0].createdAt) {
      this.createdAt = new Date(source.images[0].createdAt)
    }
    const inference = source.inferencePayload
    if (inference) {
      this.prompt = inference.prompt
      if (inference.negativePrompt) this.negativePrompt = inference.negativePrompt
      if (inference.numInferenceSteps)
        this.addParam(PARAM.steps, inference.numInferenceSteps)
      else // Steps value necessary for later parsing!
        this.addParam(PARAM.steps, 'unknown')
      this.width = inference.outputWpx
      this.height = inference.outputHpx
      this.addParam(PARAM.size, this.size)
      if (inference.seed) this.addParam(PARAM.seed, inference.seed)
      this.addParam(PARAM.method, 'happyaccidents.ai')
      if (inference.modelId) {
        const modelName = haModels[inference.modelId]
        if (modelName) this.addParam(PARAM.model, modelName)
        else {
          console.log(`Warning: inference ${this.id} uses unknown model ID ${inference.modelId}`)
          this.addParam('Model ID', inference.modelId)
        }
      }
      if (inference.samplingMethod) this.addParam(PARAM.sampler, inference.samplingMethod)
      if (inference.guidanceScale) this.addParam(PARAM.cfgScale, inference.guidanceScale)
      if (inference.lora && inference.lora.length > 0) {
        const loras = {}
        inference.lora.forEach(lObj => {
          const loraName = haLoras[lObj.id]
          loras[loraName || lObj.id] = lObj.weight
        })
        this.addParam('Lora', loras)
      }
      if (inference.vae) this.addParam(PARAM.vae, inference.vae)
      if (inference.clipSkip) this.addParam(PARAM.clipSkip, inference.clipSkip)
      // todo: handle image-to-image, upscales, inpainting, etc.
      if (inference.imageUrl) this.initialImage = inference.imageUrl
      if (inference.upscale > 1) {
        this.addParam(PARAM.upscale, inference.upscale)
      }
      if (hasImages) {
        this.outputFileCount = source.images.length
        this.variations = source.images.map(img => ({
          id: img.id,
          idShort: this.idShort + '-' + GetFilenameSuffix(img.filename),
          __url: `https://ik.imagekit.io/hb42m9hh0/${img.folderPath}/${img.filename}`,
          __ext: GetFilenameExtension(img.filename),
        }))
      }
    }
  }

  initFromMageSpace (source) {
    this.createdBy = 'mage.space'
    this.id = source.id
    this.idShort = this.id.substr(0, 10)
    this.createdAt = new Date(source.created_at)
    const sourceMeta = source.metadata
    this.prompt = sourceMeta.prompt
    if (sourceMeta.negative_prompt) {
      this.negativePrompt = sourceMeta.negative_prompt
    }
    this.addParam(PARAM.steps, sourceMeta.num_inference_steps)
    this.width = sourceMeta.width || source.width
    this.height = sourceMeta.height || source.height
    this.addParam(PARAM.size, this.size)
    if (sourceMeta.seed) this.addParam(PARAM.seed, sourceMeta.seed)
    this.addParam(PARAM.method, 'mage.space')
    const modelName = source.model_name || sourceMeta.model_name
    let modelVers = source.model_version || sourceMeta.model_version
    if (source.model_version && sourceMeta.model_version && (source.model_version !== sourceMeta.model_version)) {
      modelVers += '/' + sourceMeta.model_version
    }
    this.addParam(PARAM.model, modelName + '/' + modelVers)
    if (sourceMeta.scheduler) this.addParam(PARAM.sampler, sourceMeta.scheduler)
    if (sourceMeta.guidance_scale) this.addParam(PARAM.cfgScale, sourceMeta.guidance_scale)
    if (sourceMeta.clip_skip) { // only on v1.5, not sdxl
      this.addParam(PARAM.clipSkip, 1)
    }
    if ('use_refiner' in sourceMeta) { // probably sdxl
      if (sourceMeta.use_refiner) {
        if (sourceMeta.refiner_strength) {
          this.addParam('Refiner strength', sourceMeta.refiner_strength)
        } else if (sourceMeta.denoising_frac) {
          this.addParam('Refiner denoise percentage', Math.round((1.0 - sourceMeta.denoising_frac)*1000)/1000)
        }
      }
    }
    // todo: handle image-to-image, upscales, inpainting, etc.
    if (source.image_url) {
      this.outputFileCount = 1
      this.variations = [
        {
          id: this.id,
          idShort: this.idShort,
          __url: source.image_url,
          __ext: GetUrlExtension(source.image_url),
        }
      ]
    }
  }

  initFromUnstabilityAI (source) {
    this.createdBy = 'unstability.ai'
    this.id = source.id.substr(source.id.indexOf('#') + 1)
    this.idShort = this.id.substr(0, 8) + this.id.substr(9, 2)
    if (source.finished_at) this.createdAt = new Date(source.finished_at)
    else if (source.accepted_at) this.createdAt = new Date(source.accepted_at)
    else if (source.requested_at) this.createdAt = new Date(source.requested_at)
    // if (source.publishedAt) this.publishedAt = new Date(source.publishedAt)
    // if (source.title) this.title = source.title
    const image_info = source.image_info
    if (image_info) {
      // if (image_info.initialImage) this.initialImage = image_info.initialImage
      // if (image_info.iterations) this.params.steps = image_info.iterations
      this.prompt = image_info.prompt
      if (image_info.negative_prompt) this.negativePrompt = image_info.negative_prompt
      if (image_info.steps)
        this.addParam(PARAM.steps, image_info.steps)
      else // Steps value necessary for later parsing!
        this.addParam(PARAM.steps, 'unknown')
      this.width = image_info.width
      this.height = image_info.height
      this.addParam(PARAM.size, this.size)
      if (image_info.aspect_ratio)
        this.addParam(unstaparam.aspect_ratio, image_info.aspect_ratio)
      this.addParam(PARAM.method, 'unstability.ai')
      if (image_info.genre) {
        if (image_info.style) {
          if (image_info.style.startsWith(image_info.genre)) { // normal case
            this.addParam(PARAM.model, image_info.style)
          } else {
            this.addParam(PARAM.model, image_info.genre + '/' + image_info.style)
          }
        } else {
          this.addParam(PARAM.model, image_info.genre)
        }
      } else if (image_info.style) {
        this.addParam(PARAM.model, image_info.style)
      }
      if (image_info.lighting_filter) {
        this.addParam(unstaparam.lighting_filter, unstaparam[image_info.lighting_filter])
        if (image_info.lighting_filter == 'complementary-compositon'
          || image_info.lighting_filter == 'color-guidance'
          || image_info.lighting_filter == 'dual-color-guidance'
        ) {
          if (image_info.lighting_filter_color)
            this.addParam(unstaparam.lighting_filter_color, image_info.lighting_filter_color)
          if (image_info.lighting_filter == 'dual-color-guidance') {
            if (image_info.lighting_filter_negative_color)
              this.addParam(unstaparam.lighting_filter_negative_color, image_info.lighting_filter_negative_color)
          }
          if (image_info.lighting_filter != 'complementary-compositon') {
            if ('alternate_mode' in image_info)
              this.addParam(unstaparam.alternate_mode, image_info.alternate_mode)
          }
        }
      }
      if (image_info.lighting_filter_strength)
        this.addParam(unstaparam.lighting_filter_strength, image_info.lighting_filter_strength)
      if (image_info.detail_pass_strength)
        this.addParam(unstaparam.detail_pass_strength, image_info.detail_pass_strength)
      if (image_info.saturation)
        this.addParam(unstaparam.saturation, image_info.saturation)
    }
    // if (source.link && source.link !== 'null') this.url = source.link
    if (source.images && source.images.length > 0) {
      this.variations = source.images.map((v, i) => ({
        id: v.id.substr(v.id.indexOf('#') + 1),
        idShort: this.idShort + '-' + i,
        __url: v.original,
        __ext: GetUrlExtension(v.original),
      }))
    }
  }

  initFromCivitai (source) {
    this.createdBy = 'Civitai'
    this.method = 'Civitai'
    this.id = source.id.toString()
    this.idShort = this.id
    this.createdAt = new Date(source.createdAt)
    if (source.status !== 'Succeeded') {
      this.error = true
    }
    const sourceParams = source.params
    this.prompt = sourceParams.prompt
    if (sourceParams.negativePrompt) {
      this.negativePrompt = sourceParams.negativePrompt
    }
    this.addParam(PARAM.steps, sourceParams.steps)
    this.width = sourceParams.width
    this.height = sourceParams.height
    this.addParam(PARAM.size, this.size)
    this.addParam(PARAM.seed, sourceParams.seed) // unconditional -- if null will be overridden by image later
    this.addParam(PARAM.method, 'Civitai')

    if (source.model) { // "@civitai/197726"
      let modelSet = false
      const modelVers = source.model.split('/')
      if (modelVers.length > 1 && source.resources && source.resources.length > 0) {
        const resource = source.resources.find(r => r.id.toString() === modelVers[1])
        if (resource) {
          this.addParam(PARAM.model, resource.modelName + (resource.name ? ' ' + resource.name : ''))
          modelSet = true
        }
      }
      if (!modelSet) {
        this.addParam(PARAM.model, source.model)
      }
    }
    if (sourceParams.scheduler) this.addParam(PARAM.sampler, sourceParams.scheduler)
    if (sourceParams.cfgScale) this.addParam(PARAM.cfgScale, sourceParams.cfgScale)
    if (sourceParams.clipSkip) this.addParam(PARAM.clipSkip, sourceParams.clipSkip)
    if (source.resources) {
      const abbr = source.resources.map(r => ({
        type: r.modelType.toLowerCase(),
        modelVersionId: r.id,
      }))
      this.addParam('Civitai resources', abbr) // must be last param added!!
    }
    // todo: handle image-to-image, upscales, inpainting, etc.
    if (source.quantity) this.outputFileCount = source.quantity
    if (source.images) {
      this.variations = source.images
        .map((img, idx) => ({
          id: img.id,
          idShort: this.id + '-' + (idx + 1),
          hash: img.hash,
          __url: img.available && img.url,
          __ext: '.jpg',
          seed: img.seed,
          available: img.available,
        }))
        .filter(v => v.__url)
    }
  }

  // static escapePromptBreaks (prompt) {
  //   if (typeof prompt !== 'string') return ''
  //   const lines = prompt.split('\n')
  //   if (lines.length === 1) {
  //     return prompt
  //   } // else lines.length > 1
  //   for (let i = 0; i < lines.length - 1; i++) {
  //     lines[i] += (lines[i].endsWith(' ') ? 'BREAK' : ' BREAK')
  //   }
  //   return lines.join('\n')
  // }

  // static unescapePromptBreaks (prompt) {

  // }

  getTagsToEmbed (toEmbed = {}, img, ext) {
    if (this.hasData) {
      const UserComment = this.toParamString(img.seed)
      toEmbed['UserComment'] = UserComment
      if (ext === '.png') {
        toEmbed['PNG:parameters'] = UserComment
        if (this.url) {
          toEmbed['PNG:URL'] = this.url
        }
        if (this.hasDate) {
          toEmbed['PNG:CreationTime'] = this.getLocalDateISO() // Windows Explorer "Date Taken" for PNGs
        }
      }
      if (this.hasDate) {
        // set date/time when original image was "taken" (for non-PNGs)
        toEmbed['EXIF:DateTimeOriginal'] = this.getLocalDateANTZ()
        toEmbed['EXIF:OffsetTimeOriginal'] = this.getLocalTimeZone()
        // set date/time image was "digitized"
        toEmbed['EXIF:CreateDate'] = this.getLocalDateANTZ()
        toEmbed['EXIF:OffsetTimeDigitized'] = this.getLocalTimeZone()
      }
      if (this.createdBy) {
        toEmbed['EXIF:Software'] = this.createdBy
      }
      if (this.id) {
        toEmbed['EXIF:ReelName'] = this.id
      }
      if (typeof img.num === 'string') {
        toEmbed['EXIF:ImageNumber'] = Number.parseInt(img.num)
      } else if (typeof img.num === 'number') {
        toEmbed['EXIF:ImageNumber'] = img.num
      }
      // store image's unique ID
      if (img.id) {
        toEmbed['EXIF:ImageUniqueID'] = String(img.id).replace(/\-/g, '')
      }
    }
    return toEmbed
  }

  getPropertyString (seedOverride) {
    return this.params
      .map((p, idx, all) => p[0] + ': '
        + (seedOverride && p[0] === PARAM.seed ? seedOverride : SerializeParamValue(p[1], idx + 1 === all.length)))
      .join(', ')
  }

  get hasDate () {
    return Boolean(this.createdAt || this.publishedAt)
  }

  getLocalDateANTZ (dateOverride) {
    if (dateOverride) {
      return FormatLocalDateTimeANTZ(dateOverride)
    }
    if (this.createdAt) {
      return FormatLocalDateTimeANTZ(this.createdAt)
    }
    if (this.publishedAt) {
      return FormatLocalDateTimeANTZ(this.publishedAt)
    }
    return null
  }

  getLocalTimeZone (dateOverride) {
    if (dateOverride) {
      return FormatLocalDateTimeZone(dateOverride)
    }
    if (this.createdAt) {
      return FormatLocalDateTimeZone(this.createdAt)
    }
    if (this.publishedAt) {
      return FormatLocalDateTimeZone(this.publishedAt)
    }
    return null
  }

  getLocalDateISO (dateOverride) {
    if (dateOverride) {
      return FormatLocalDateTimeISO(dateOverride)
    }
    if (this.createdAt) {
      return FormatLocalDateTimeISO(this.createdAt)
    }
    if (this.publishedAt) {
      return FormatLocalDateTimeISO(this.publishedAt)
    }
    return null
  }

  getUTCDateISO (dateOverride) {
    if (dateOverride) {
      return dateOverride.toISOString()
    }
    if (this.createdAt) {
      return this.createdAt.toISOString()
    }
    if (this.publishedAt) {
      return this.publishedAt.toISOString()
    }
    return null
  }

  toParamString (seedOverride) {
    let result = this.prompt // SDMetadata.escapePromptBreaks(this.prompt)
    if (this.negativePrompt)
      result += '\nNegative prompt: ' + this.negativePrompt // SDMetadata.escapePromptBreaks(this.negativePrompt)
    let props = this.getPropertyString(seedOverride)
    if (props)
      result += '\n' + props
    return result
  }
}

exports.SDMetadata = SDMetadata

function SerializeParamValue (value, isLast = false) {
  if (Array.isArray(value)) {
    return isLast
      ? JSON.stringify(value)
      : '"' + value.map(v => SerializeParamValue(v)).join(', ') + '"'
  } else if (value && typeof value == 'object') {
    return isLast
      ? JSON.stringify(value)
      : '"' + Object.entries(value).map(e => e[0] + ': ' + SerializeParamValue(e[1])).join(', ') + '"'
  } else {
    return '' + value
  }
}
