const PARAM = {
  steps: 'Steps',
  sampler: 'Sampler',
  cfgScale: 'CFG scale',
  seed: 'Seed',
  size: 'Size',
  modelHash: 'Model hash',
  model: 'Model',
  vaeHash: 'VAE hash',
  vae: 'VAE',
  denoisingStrength: 'Denoising strength', // applicable only in img2img?
  clipSkip: 'Clip skip', // applicable only in sd1.x, not sdxl
  hiresUpscale: 'Hires upscale',
  hiresSteps: 'Hires steps',
  hiresUpscaler: 'Hires upscaler',
  loraHashes: 'Lora hashes',
  tiHashes: 'TI hashes',
  version: 'Version',
  hashes: 'Hashes',
}
exports.PARAM = PARAM

class MDParams {
  constructor () {
    this.params = []
  }

  get hasData () {
    return this.steps > 0
  }

  getParam (name) {
    const p = this.params.find(p => p.name === name)
    return p && p.value
  }

  setParam (name, value) {
    const p = this.params.find(p => p.name === name)
    if (p) {
      p.value = value
    } else {
      this.params.push({ name, value })
    }
  }

  get steps () {
    return this.getParam(PARAM.steps)
  }

  set steps (value) {
    this.setParam(PARAM.steps, value)
  }

  get sampler () {
    return this.getParam(PARAM.sampler)
  }

  set sampler (value) {
    this.setParam(PARAM.sampler, value)
  }

  get cfgScale () {
    return this.getParam(PARAM.cfgScale)
  }

  set cfgScale (value) {
    this.setParam(PARAM.cfgScale, value)
  }

  get seed () {
    return this.getParam(PARAM.seed)
  }

  set seed (value) {
    this.setParam(PARAM.seed, value)
  }

  get size () {
    return this.getParam(PARAM.size)
  }

  set size (value) {
    this.setParam(PARAM.size, value)
  }

  get width () {
    const size = this.size
    const endPos = size && size.indexOf('x')
    return endPos && size.substring(0, endPos).trim()
  }

  set width (value) {
    const size = this.size
    if (size) {
      const wh = size.split('x')
      this.size = '' + value + 'x' + (wh[1] || '')
    } else {
      this.size = '' + value + 'x'
    }
  }

  get height () {
    const size = this.size
    const pos = size && size.indexOf('x') + 1
    return pos && size.substring(pos).trim()
  }

  set height (value) {
    const size = this.size
    if (size) {
      const wh = size.split('x')
      this.size = (wh[0] || '') + 'x' + value
    } else {
      this.size = 'x' + value
    }
  }

  get modelHash () {
    return this.getParam(PARAM.modelHash)
  }

  set modelHash (value) {
    this.setParam(PARAM.modelHash, value)
  }

  get model () {
    return this.getParam(PARAM.model)
  }

  set model (value) {
    this.setParam(PARAM.model, value)
  }

  get vaeHash () {
    return this.getParam(PARAM.vaeHash)
  }

  set vaeHash (value) {
    this.setParam(PARAM.vaeHash, value)
  }

  get vae () {
    return this.getParam(PARAM.vae)
  }

  set vae (value) {
    this.setParam(PARAM.vae, value)
  }

  get denoisingStrength () {
    return this.getParam(PARAM.denoisingStrength)
  }

  set denoisingStrength (value) {
    this.setParam(PARAM.denoisingStrength, value)
  }

  get clipSkip () {
    return this.getParam(PARAM.clipSkip)
  }

  set clipSkip (value) {
    this.setParam(PARAM.clipSkip, value)
  }

  get hiresUpscale () {
    return this.getParam(PARAM.hiresUpscale)
  }

  set hiresUpscale (value) {
    this.setParam(PARAM.hiresUpscale, value)
  }

  get hiresSteps () {
    return this.getParam(PARAM.hiresSteps)
  }

  set hiresSteps (value) {
    this.setParam(PARAM.hiresSteps, value)
  }

  get hiresUpscaler () {
    return this.getParam(PARAM.hiresUpscaler)
  }

  set hiresUpscaler (value) {
    this.setParam(PARAM.hiresUpscaler, value)
  }

  get loraHashes () {
    return this.getParam(PARAM.loraHashes)
  }

  set loraHashes (value) {
    this.setParam(PARAM.loraHashes, value)
  }

  get tiHashes () {
    return this.getParam(PARAM.tiHashes)
  }

  set tiHashes (value) {
    this.setParam(PARAM.tiHashes, value)
  }

  get version () {
    return this.getParam(PARAM.version)
  }

  set version (value) {
    this.setParam(PARAM.version, value)
  }

  get hashes () {
    return this.getParam(PARAM.hashes)
  }

  set hashes (value) {
    this.setParam(PARAM.hashes, value)
  }

  static parse (paramStr) {
    const params = new MDParams()
    let name
    const state = { remaining: paramStr }
    while ((name = MDParams.takeName(state))) {
      params.params.push({
        name,
        value: MDParams.takeValue(state)
      })
    }
    return params
  }

  static takeName (stateObj) {
    let result
    const end = stateObj.remaining.indexOf(': ')
    if (end > 0) {
      result = stateObj.remaining.slice(0, end)
      stateObj.remaining = stateObj.remaining.slice(end + 2)
    }
    return result
  }

  static takeValue (stateObj) {
    let result
    const peekChar = stateObj.remaining[0]
    if (peekChar === '[' || peekChar === '{') { // looks like JSON, which means it should be last
      result = JSON.parse(stateObj.remaining)
      stateObj.remaining = ''
    } else if (peekChar === '"') { // either quoted string or nested params
      const end = stateObj.remaining.indexOf('", ')
      if (end > 0) {
        const subParams = stateObj.remaining.slice(0, end + 1)
        if (subParams.includes(': ')) {
          result = MDParams.parse(subParams.slice(1, -1))
        } else {
          result = subParams
        }
        stateObj.remaining = stateObj.remaining.slice(end + 3)
      }
    } else { // just a plain, unquoted string or whatever
      const end = stateObj.remaining.indexOf(', ')
      if (end >= 0) {
        result = stateObj.remaining.slice(0, end)
        stateObj.remaining = stateObj.remaining.slice(end + 2)
      } else {
        result = stateObj.remaining
        stateObj.remaining = ''
      }
    }
    return result
  }

  toString (seedOverride) {
    let paramStrings = this.params.map(p => {
      let valStr
      if (typeof p.value === 'string' || typeof p.value === 'number')
        valStr = seedOverride && (p.name === PARAM.seed) ? seedOverride : p.value
      else if (p.value instanceof MDParams)
        valStr = '"' + p.value.toString() + '"'
      else
        valStr = JSON.stringify(p.value)
      return p.name + ': ' + valStr
    })
    return paramStrings.join(', ')
  }
}
exports.MDParams = MDParams
