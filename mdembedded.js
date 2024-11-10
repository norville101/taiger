const { MDParams } = require('./mdparams')

class MDEmbedded {
  constructor (text) {
    if (text) {
      let split = text.lastIndexOf('\nSteps:')
      if (split >= 0) {
        this.params = MDParams.parse(text.substring(split + 1))
        text = text.substring(0, split)
      }
      this.negativePrompt = ''
      split = text.lastIndexOf('\nNegative')
      if (split >= 0) {
        this.negativePrompt = text.substring(split + 1)
        text = text.substring(0, split)
        split = this.negativePrompt.indexOf(':')
        if (split > 0) {
          this.negativePrompt = this.negativePrompt.substring(split + 1).trim()
        }
      }
      this.prompt = text
    } else {
      this.prompt = ''
      this.negativePrompt = ''
      this.params = new MDParams()
    }
  }

  get hasData () {
    return (typeof this.prompt === 'string') && (this.params.hasData || Boolean(this.prompt))
  }

  getParam (name) {
    return this.params && this.params.getParam(name)
  }

  setParam (name, value) {
    if (!this.params) throw new Error('params is undefined!')
    this.params.setParam(name, value)
  }

  toString (seedOverride) {
    const paramStr = this.params && this.params.toString(seedOverride)
    return this.prompt
      + (this.negativePrompt ? '\nNegative prompt: ' + this.negativePrompt : '')
      + (paramStr ? '\n' + paramStr : '')
  }

  static parse (text) {
    return new MDEmbedded(text)
  }
}
exports.MDEmbedded = MDEmbedded
