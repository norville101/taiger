const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const {
  FormatLocalDateTimeANTZ,
  FormatLocalDateTimeISO,
  FormatLocalDateTimeZone,
  GetFilenameExtension,
  GetUrlExtension,
} = require("./utils")

const filenameRE = /^(?<prefix>[A-Fa-f0-9]{6,64})?(?:-?(?<num>\d{1,2})\s*-?\s*)?(?:\s*-?\s*(?:x\s?(?<scale>\d{1,2})|(?<scale2>\d{1,2})\s?x)\s*-?\s*)?(?<label>.*)?(?<ext>\.[A-Za-z]{3,4})$/

class LocalImageFile {
  constructor (filepath) {
    if (filepath) {
      this.setLocalFile(filepath)
    } else {
      this.file = '' // full local path to file
      this.name = '' // filename incl. extension
      this.ext = '' // file extension (including .)
      this.fileCreatedAt = null // date/time file was created
      this.fnPrefix = '' // portion of name parsed as a (batch) 'prefix'
      this.fnImageNum = '' // portion of name parsed as a number (within a batch)
      this.fnScale = '' // upscale factor detected from filename, if any
      this.fnLabel = '' // portion of name parsed as an image label
    }
    this.createdAt = null // embedded "taken at" / image creation date/time
    this.userComment = '' // embedded stable diffusion metadata string (semi-standard-ish)
    this.software = '' // embedded name of software used to create image (non-standard)
    this.reelName = '' // embedded unique ID of generation batch
    this.imageNumber = undefined // embedded number of image within generation batch
    this.uniqueId = '' // embedded unique identifier of image
    this.seedOverride = '' // seed override, when individual images in a creation have independent seed values
    if (this.ext === '.png') {
      this.pngParameters = '' // PNG Parameters string (typically same as userComment)
      this.pngUrl = '' // URL where image resides on the public web, if anywhere
    }
  }

  get hasLocalFile () {
    if (this.file) {
      return fs.existsSync(this.file)
    }
    return false
  }

  get shortReelName () {
    if (this.reelName && this.reelName.length > 10) {
      return this.reelName.replace(/\-/g, '').substring(0, 10)
    }
    return this.reelName
  }

  get variationId () {
    return this.shortReelName + (typeof this.imageNumber === 'number' ? '-' + String(this.imageNumber) : '')
  }

  setLocalFile (filepath, dateOverride = undefined) {
    this.file = filepath
    if (dateOverride)
      this.fileCreatedAt = dateOverride
    else {
      // get creation time of the file
      const stats = fs.statSync(filepath)
      const modified = stats.mtime // last file modification
      const created = stats.birthtime // file creation
      this.fileCreatedAt = (modified < created) ? modified : created
    }
    // see what we can get out of filename (helpful if little or no other metadata exists)
    const filename = path.basename(filepath)
    this.name = filename
    const match = filenameRE.exec(filename)
    if (match) {
      this.fnPrefix = match.groups['prefix']
      this.fnImageNum = match.groups['num']
      this.fnScale = match.groups['scale'] || match.groups['scale2']
      this.fnLabel = match.groups['label']
      this.ext = match.groups['ext']
    } else {
      this.ext = GetFilenameExtension(filename)
    }
  }

  async readImageMetadata (exiftool) {
    if (this.file && this.ext && ['.png', '.jpg', '.jpeg', '.webp'].includes(this.ext.toLowerCase())) {
      // extract additional metadata FROM image...
      const embedded = await exiftool.read(this.file, ['-G'])
      if (embedded['PNG:CreationTime']) {
        this.createdAt = embedded['PNG:CreationTime']
      } else if (embedded['EXIF:DateTimeOriginal']) {
        this.createdAt = embedded['EXIF:DateTimeOriginal']
        // if (embedded['EXIF:OffsetTimeOriginal']) { // already handled in exiftool.read()?
        //   result.createdAt += embedded['EXIF:OffsetTimeOriginal']
        // }
      } else if (embedded['EXIF:CreateDate']) {
        this.createdAt = embedded['EXIF:CreateDate']
        // if (embedded['EXIF:OffsetTimeDigitized']) { // already handled in exiftool.read()?
        //   result.createdAt += embedded['EXIF:OffsetTimeDigitized']
        // }
      }
      if (this.createdAt && this.createdAt.toDate) {
        this.createdAt = this.createdAt.toDate() // we want a plain old JS date, not a fancy ExifDateTime object
      }
      if (embedded['EXIF:UserComment']) {
        this.userComment = embedded['EXIF:UserComment']
      }
      if (embedded['EXIF:Software']) {
        this.software = embedded['EXIF:Software']
      }
      if (embedded['EXIF:ReelName']) {
        this.reelName = embedded['EXIF:ReelName']
      }
      if (embedded['EXIF:ImageNumber']) {
        this.imageNumber = embedded['EXIF:ImageNumber']
      }
      if (embedded['EXIF:ImageUniqueID']) {
        this.uniqueId = embedded['EXIF:ImageUniqueID']
      }
      if (embedded['PNG:parameters']) {
        this.pngParameters = embedded['PNG:parameters']
      }
      if (embedded['PNG:URL']) {
        this.pngUrl = embedded['PNG:URL']
      }
      if (embedded['EXIF:ImageHistory']) {
        this.imageHistory = embedded['EXIF:ImageHistory']
      }
      if (embedded['PNG:GenInfo']) {
        const genInfo = JSON.parse(embedded['PNG:GenInfo'])
        this.dezgoGenInfo = genInfo
      }
      if (embedded['PNG:GenCode']) {
        this.dezgoGenCode = embedded['PNG:GenCode']
      }
      if (embedded['Composite:ImageSize']) {
        this.imageSize = embedded['Composite:ImageSize']
      }
    }
  }

  getTagsToEmbed (toEmbed = {}) {
    if (this.userComment) {
      toEmbed['UserComment'] = this.userComment
    }
    if (this.ext === '.png') {
      if (this.pngParameters || this.userComment) {
        toEmbed['PNG:parameters'] = this.pngParameters || this.userComment
      }
      if (this.pngUrl) {
        toEmbed['PNG:URL'] = this.pngUrl
      }
      if (this.createdAt) {
        toEmbed['PNG:CreationTime'] = this.getLocalDateISO() // Windows Explorer "Date Taken" for PNGs
      }
    }
    if (this.createdAt) {
      // set date/time when original image was "taken" (for non-PNGs)
      toEmbed['EXIF:DateTimeOriginal'] = this.getLocalDateANTZ()
      toEmbed['EXIF:OffsetTimeOriginal'] = this.getLocalTimeZone()
      // set date/time image was "digitized"
      toEmbed['EXIF:CreateDate'] = this.getLocalDateANTZ()
      toEmbed['EXIF:OffsetTimeDigitized'] = this.getLocalTimeZone()
    }
    if (this.software) {
      toEmbed['EXIF:Software'] = this.software
    }
    if (this.reelName) {
      toEmbed['EXIF:ReelName'] = this.reelName
    }
    if (typeof this.imageNumber === 'number' && !isNaN(this.imageNumber)) {
      toEmbed['EXIF:ImageNumber'] = this.imageNumber
    }
    // store image's unique ID
    if (this.uniqueId) {
      toEmbed['EXIF:ImageUniqueID'] = String(this.uniqueId).replace(/\-/g, '')
    }
    // remove custom metadata embedded by Dezgo
    if (this.dezgoGenCode || this.dezgoGenInfo) {
      if (!('PNG:GenInfo' in toEmbed)) toEmbed['PNG:GenInfo'] = null
      if (!('PNG:GenCode' in toEmbed)) toEmbed['PNG:GenCode'] = null
      if (!('EXIF:ImageHistory' in toEmbed)) toEmbed['EXIF:ImageHistory'] = null
    }
    return toEmbed
  }

  getLocalDateANTZ (defaultValue) {
    if (this.createdAt) {
      return FormatLocalDateTimeANTZ(this.createdAt)
    }
    if (this.fileCreatedAt) {
      return FormatLocalDateTimeANTZ(this.fileCreatedAt)
    }
    return defaultValue
  }

  getLocalTimeZone (defaultValue) {
    if (this.createdAt) {
      return FormatLocalDateTimeZone(this.createdAt)
    }
    if (this.fileCreatedAt) {
      return FormatLocalDateTimeZone(this.fileCreatedAt)
    }
    return defaultValue
  }

  getLocalDateISO (defaultValue) {
    if (this.createdAt) {
      return FormatLocalDateTimeISO(this.createdAt)
    }
    if (this.fileCreatedAt) {
      return FormatLocalDateTimeISO(this.fileCreatedAt)
    }
    return defaultValue
  }

  getUTCDateISO (defaultValue) {
    if (this.createdAt) {
      return this.createdAt.toISOString()
    }
    if (this.fileCreatedAt) {
      return this.fileCreatedAt.toISOString()
    }
    return defaultValue
  }
}

/**
 * RemoteImageFile workflows:
 *   Typically we create a RemoteImageFile when we intend to download a remote image. In this case
 *   we may already know some or all of the metadatea, but we want the image locally so we can
 *   name it, ensure the desired metadata embedding, and manage it locally using other tools.
 *   So it gets created, with the url(s). Thereafter if some metadata is already known, that can be used to set
 *   the (desired) file path and name, which (with the url) is then used to download the file locally.
 *   Then once it exists locally, whatever metadata is already embedded is extracted from the file and used
 *   to initialize the remaining members of LocalImageFile. These properties may then be used to make higher- (batch-)
 *   level inferences about this and other images if desired.
 * 
 *   We only create RemoteImageFile objects when we do not already have an image locally, so we need to download it.
 *   Otherwise -- when we already have an image locally -- we simply create a LocalImageFile object for it.
 */
class RemoteImageFile extends LocalImageFile {
  constructor (url, ext = undefined, headers = null, urlAlt = undefined, extAlt = undefined) {
    super()
    this.url = url // URL from which the image may be downloaded in the best quality available
    this.ext = ext || GetUrlExtension(url)
    if (urlAlt) {
      this.urlAlt = urlAlt // alternate URL from which a more compressed form of the image may be downloaded (if available)
      this.extAlt = extAlt || GetUrlExtension(urlAlt) // file extension of the more compressed form of the image (if available)
    }
    this.headers = headers // custom headers needed in order to download this image
  }

  get isRemote () {
    return Boolean(this.url)
  }
}

module.exports = {
  LocalImageFile,
  RemoteImageFile,
}