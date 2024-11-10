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

function isMatch (source) {
  // return Boolean(source.image_info && source.images && source.image_info.lighting_filter) // old API?
  return Boolean(source.genInfo && source.original && source.genInfo.lighting_filter) // as of 28 Jun 2024
}
exports.isMatch = isMatch

async function sourceToCreation (source, creation) {
  creation.createdBy = 'unstability.ai'
  creation.id = source.prefix // source.pk.substr(source.pk.indexOf('#') + 1)
  creation.orderById = false // which means a time-based prefix will be added and title omitted from filename
  // creation.idShort = creation.id.substr(0, 8) + creation.id.substr(9, 2)
  if (source.requested_at) {
    creation.createdAt = new Date(source.requested_at)
  }
  const image_info = source.genInfo
  if (image_info) {
    creation.prompt = image_info.prompt
    if (image_info.negative_prompt) {
      creation.negativePrompt = image_info.negative_prompt
    }
    creation.setParam(PARAM.steps, 'unknown')
    creation.width = image_info.width
    creation.height = image_info.height
    creation.setParam(PARAM.size, `${image_info.width}x${image_info.height}`)
    if (image_info.aspect_ratio) {
      creation.setParam(unstaparam.aspect_ratio, image_info.aspect_ratio)
    }
    let seed = image_info.seed
    if (typeof seed === 'number' && seed >= 0) {
      creation.setParam(PARAM.seed, seed)
    }
    if (image_info.genre) {
      if (image_info.style) {
        if (image_info.style.startsWith(image_info.genre)) { // normal case
          creation.setParam(PARAM.model, image_info.style)
        } else {
          creation.setParam(PARAM.model, image_info.genre + '/' + image_info.style)
        }
      } else {
        creation.setParam(PARAM.model, image_info.genre)
      }
    } else if (image_info.style) {
      creation.setParam(PARAM.model, image_info.style)
    }
    if (image_info.lighting_filter) {
      creation.setParam(unstaparam.lighting_filter, unstaparam[image_info.lighting_filter])
      if (image_info.lighting_filter == 'complementary-compositon'
        || image_info.lighting_filter == 'color-guidance'
        || image_info.lighting_filter == 'dual-color-guidance'
      ) {
        if (image_info.lighting_filter_color)
          creation.setParam(unstaparam.lighting_filter_color, image_info.lighting_filter_color)
        if (image_info.lighting_filter == 'dual-color-guidance') {
          if (image_info.lighting_filter_negative_color)
            creation.setParam(unstaparam.lighting_filter_negative_color, image_info.lighting_filter_negative_color)
        }
        if (image_info.lighting_filter != 'complementary-compositon') {
          if ('alternate_mode' in image_info)
            creation.setParam(unstaparam.alternate_mode, image_info.alternate_mode)
        }
      }
    }
    if (image_info.lighting_filter_strength)
      creation.setParam(unstaparam.lighting_filter_strength, image_info.lighting_filter_strength)
    if (image_info.detail_pass_strength)
      creation.setParam(unstaparam.detail_pass_strength, image_info.detail_pass_strength)
    if (image_info.saturation)
      creation.setParam(unstaparam.saturation, image_info.saturation)

    // if (source.title) creation.title = source.title
    // if (source.link && source.link !== 'null') creation.url = source.link
    // if (source.initialImage) creation.sourceImageUrl = source.initialImage
  }
  creation.variations = [{
  }]

  if (source.images && source.images.length > 0) {
    creation.variations = source.images.map((v, i) => ({
      id: v.id.substr(v.id.indexOf('#') + 1),
      // idShort: creation.idShort + '-' + i,
      __url: v.original,
      __ext: GetUrlExtension(v.original),
    }))
  }

  // sample from starryAI...
  if (source.variations && source.variations.length > 0 && (!options || !options.upscalesOnly)) {
    creation.images = []
    let lastImageNum = 0
    source.variations.forEach(img => {
      const urlExt = img.url && GetUrlExtension(img.url) || '.png'
      const compressedExt = img.compressed && GetUrlExtension(img.compressed) || '.webp'
      let newImg
      /* if (options?.compressed && img.compressed) {
        newImg = new RemoteImageFile(img.compressed, compressedExt)
      } else */ if (img.url) {
        newImg = new RemoteImageFile(img.url, urlExt, undefined, img.compressed, compressedExt)
      } else if (img.compressed) {
        newImg = new RemoteImageFile(img.compressed, compressedExt)
      }
      if (newImg) {
        newImg._orig_meta = img
        const idparts = img.id.split('-')
        if (!isV2 || idparts[0] === 'og' || img.type === 'original') {
          newImg.fnPrefix = newImg.reelName = idparts[isV2 ? 1 : 0] // no op
          newImg.imageNumber = Number.parseInt((newImg.fnImageNum = idparts[isV2 ? 2 : 1]))
          lastImageNum = newImg.imageNumber
          if (img.compressed) {
            newImg.uniqueId = path.basename(GetUrlFilename(img.compressed), compressedExt).replace(/\-/g, '')
          }
        } else if (img.type && img.status === 'completed') { // V2
          newImg.fnPrefix = newImg.reelName = idparts[1] // no op
          if (img.type === 'upscale') {
            // try to figure out which image number the upscale belongs to!
            if (lastImageNum) {
              newImg.imageNumber = lastImageNum
              newImg.fnImageNum = String(newImg.imageNumber)
              lastImageNum = 0
            }
            if (img.upscaleSettings && img.upscaleSettings.factor) {
              newImg.fnScale = String(img.upscaleSettings.factor)
            }
          } else if (img.type === 'enhance') {
            if (img.initImage) {
              const re = new RegExp(`enhance_${source.id}-(\\d+)_`)
              const match = re.exec(img.initImage)
              if (match) {
                newImg.imageNumber = Number.parseInt(match[1])
                newImg.fnImageNum = String(newImg.imageNumber)
              }
            }
            // get add'l settings out of enhance settings and modify filename accordingly
            newImg.fnScale = 'enh' + img.enhanceSettings?.level + '-' + img.enhanceSettings?.style
            if (img.enhanceSettings?.prompt) {
              newImg.fnScale += ' ' + img.enhanceSettings?.prompt
            }
          } else {
            console.log('Warning - unrecognized variation type')
          }
          if (!newImg.imageNumber) {
            newImg.imageNumber = Number.parseInt((newImg.fnImageNum = idparts[2]))
            newImg.fnImageNum = String(newImg.imageNumber)
          }
          if (img.url) {
            const baseName = path.basename(GetUrlFilename(img.url), '.png')
            if (baseName.endsWith('_' + idparts[2])) {
              newImg.uniqueId = baseName.slice(0, -(1 + idparts[2].length)).replace(/\-/g, '')
            }
          }
        }
        creation.images.push(newImg)
      }
    })
  }

}
exports.sourceToCreation = sourceToCreation
