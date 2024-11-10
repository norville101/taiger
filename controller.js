const fs = require('fs')
const crypto = require('crypto');
const path = require('path')
const axios = require('axios')
const { utimes } = require('utimes')
const ExifTool = require("exiftool-vendored").ExifTool
const CWebp = require('cwebp').CWebp
const { Creation } = require('./creation')
const { GetUrlExtension, GetFilenameExtension, ExtractMetadataFromImage, createHashFromFile2 } = require('./utils')
const { DetectSource } = require('./sources')
const fsp = fs.promises
const cachedir = path.join(__dirname, 'temp')
const destdir = path.join(__dirname, 'tagged')
const metadir = path.join(__dirname, 'tagged')

const dryrun = true

class Controller {
  constructor () {
  }

  async doWork (item) {
    const exiftool = new ExifTool({ exiftoolEnv: { EXIFTOOL_HOME: __dirname }})
    let options
    if (item.__options) {
      options = item.__options
      delete item.__options
    }
    try {
      // ensure destination directories exists
      await fsp.mkdir(cachedir, { recursive: true })
      await fsp.mkdir(destdir, { recursive: true })
      if (metadir !== destdir && metadir !== cachedir) {
        await fsp.mkdir(metadir, { recursive: true })
      }
      const creation = new Creation()
      creation.destdir = destdir // is this needed or used anywher?
      const src = DetectSource(item)
      if (src) {
        await src.sourceToCreation(item, creation, options)
        try {
          await this.downloadImages(creation, exiftool, options)
        } catch (e) {
          console.error('Error; image download aborted:', e)
        }
        await this.writeMetadata(creation, item, options)
      } else {
        console.log('Unrecognized object: metadata & downloads not found')
      }
    } catch (e) {
      console.error(e)
    } finally {
      exiftool.end()
    }
  }

  // async writeMetadata (filename, metadata) {
  async writeMetadata (creation, metadata, options) {
    const filename = creation.prefix + '.metadata.json'
    // ensure destination directory exists
    await fsp.mkdir(metadir, { recursive: true })
    // if applicable, download/write source image
    const imgBaseFilename = creation.prefix + ".sourceImage"
    const imgBaseFilepath = path.join(metadir, imgBaseFilename)
    if (creation.sourceImageBase64) {
      const imgFilepath = imgBaseFilepath + '.png'
      let buf = Buffer.from(creation.sourceImageBase64, 'base64')
      const hash = crypto.createHash('sha256')
      hash.update(buf)
      metadata._source_image_sha256 = hash.digest('hex')
      await fsp.writeFile(imgFilepath, buf)
      if (creation.createdAt) {
        await utimes(imgFilepath, creation.createdAt)
      }
    } else if (creation.sourceImageUrl && creation.sourceImageUrl !== 'hidden') {
      const imgExt = GetUrlExtension(creation.sourceImageUrl) || '.png'
      const imgFilepath = imgBaseFilepath + imgExt
      if (!options || !options.upscalesOnly) {
        let failed = false
        try {
          await downloadImage(creation.sourceImageUrl, imgFilepath)
          metadata._source_image_sha256 = await createHashFromFile2(imgFilepath)
          if (creation.createdAt) {
            await utimes(imgFilepath, creation.createdAt)
          }
        } catch (e) {
          if (e.code === 'ERR_BAD_REQUEST') {
            failed = true
          } else {
            console.error(e)
          }
        }
        if (failed) {
          try {
            if (fs.existsSync(imgFilepath)) {
              console.log('attempting to delete failed download: ' + imgFilepath)
              fs.unlinkSync(imgFilepath) // clean up -- don't leave 0-length file
              console.log('  ... deletion completed')
            }
          } catch (e) {
            console.error('  ... failed to delete!', e)
          }
        }
      }
    }
    const filepath = path.join(metadir, filename)
    // write metadata file
    await fsp.writeFile(filepath, JSON.stringify(metadata))
    if (creation.createdAt) {
      await utimes(filepath, creation.createdAt)
    }
  }

  async downloadImages (creation, exiftool, options) {
    let err
    // let titleFragment = creation.fnTitle
    // if (titleFragment) titleFragment = ' ' + titleFragment
    for (const remoteImage of creation.images) {
      err = false
      // let ext = creation.getVariationExtension(remoteImage, false)
      let filename = creation.getFileName(remoteImage)
      let filepath = path.join(cachedir, filename)
      let alreadyExists = remoteImage.hasLocalFile
      if (!alreadyExists) {
        try {
          await downloadImage(remoteImage.url, filepath, remoteImage.headers)
          if (remoteImage._orig_meta) {
            remoteImage._orig_meta._image_sha256 = await createHashFromFile2(filepath)
          }
        } catch (e) {
          console.error(`unable to download ${filename}: ${e.message}`)
          if (fs.existsSync(filepath)) {
            await fsp.unlink(filepath)
          }
          err = true
        }
        if (err) {
          if (remoteImage.urlAlt) {
            filename = creation.getFileName(remoteImage, true)
            filepath = path.join(cachedir, filename)
            try {
              await downloadImage(remoteImage.urlAlt, filepath)
              console.log('Fallback download succeeded')
              if (remoteImage._orig_meta) {
                remoteImage._orig_meta._imagealt_sha256 = await createHashFromFile2(filepath)
              }
              err = false
            } catch (e) {
              console.error('Fallback download also failed.')
              if (fs.existsSync(filepath)) {
                await fsp.unlink(filepath)
              }
            }
          }
        }
      }
      if (!err) {
        if (!alreadyExists) {
          remoteImage.setLocalFile(filepath)
          await remoteImage.readImageMetadata(exiftool)
        }
        const needsCompress = options?.compressed && !['.webp', '.jpg', '.jpeg'].includes(remoteImage.ext)
        let finalname, finalpath
        if (needsCompress) {
          finalname = path.basename(filename, remoteImage.ext) + '.webp'
          finalpath = path.join(destdir, finalname)
          let encoder = new CWebp(filepath)
          encoder.quality(100)
          await encoder.write(finalpath)
          remoteImage.file = finalpath
          remoteImage.name = finalname
          remoteImage.ext = '.webp'
        } else {
          finalname = filename
          finalpath = path.join(destdir, finalname)
        }
        let toEmbed = {}
        remoteImage.getTagsToEmbed(toEmbed)
        creation.getTagsToEmbed(remoteImage, toEmbed)
        // use exiftool to modify image metadata
        if (needsCompress) { // compression already written to correct location
          // tag in-place and nix backup because we still have original in download cache dir
          await exiftool.write(finalpath, toEmbed, ['-overwrite_original'])
        } else { // tagging step needs to read the file in old location and write in new location
          // wish this exiftool wrapper supported the -o ${finalpath} switch, but it apparently doesn't!
          await exiftool.write(filepath, toEmbed, [])
          await fsp.rename(filepath, finalpath)
          await fsp.rename(filepath + '_original', filepath)
      }
      }
    }
  }

  async cleanFilesInDir (pathname) {
    const exiftool = new ExifTool({ exiftoolEnv: { EXIFTOOL_HOME: __dirname }})
    try {
      // get a list of all files in the directory, and sort them by id into batches
      const files = await fsp.readdir(pathname)
      const batches = {}
      const unrecognized = []
      for (const file of files) {
        const matches = SIDRE.exec(file)
        if (matches) {
          const batch = batches[matches[0]] || (batches[matches[0]] = {})
          if (file.endsWith('.json')) {
            if (file.endsWith('.metadata.json')) { // latest
              batch.metadata = file
            } else if (file.includes('(metadata)')) { // old -- still needed if we don't have new!
              batch.oldMetadata = file
            }
          } else if (file.includes('(Initial Image)')) {
            batch.sourceImage = file
          } else {
            const imageList = batch.images || (batch.images = [])
            imageList.push(file)
          }
        } else {
          unrecognized.push(file)
        }
      }
      // now handle each batch, one at a time
      for (const [shortId, batch] of Object.entries(batches)) {
        const primaryMetadata = batch.metadata || batch.oldMetadata
        const secondaryMetadata = batch.metadata ? batch.oldMetadata : undefined
        if (primaryMetadata) {
          // read metadata
          const str = await fsp.readFile(path.join(pathname, primaryMetadata))
          const origSourceMetadata = JSON.parse(str)
          const creation = new Creation()
          const src = DetectSource(origSourceMetadata)
          if (src) {
            await src.sourceToCreation(origSourceMetadata, creation)
          }
          await doRename(pathname, primaryMetadata, creation.prefix + '.metadata.json')
          if (secondaryMetadata) {
            await doDelete(pathname, secondaryMetadata)
          }
          if (batch.sourceImage) {
            await doRename(pathname, batch.sourceImage,
              creation.prefix + '.sourceimage' + GetFilenameExtension(batch.sourceImage))
          }
          if (batch.images) {
            for (const imgname of batch.images) {
              await doRename(pathname, imgname, imgname.replace(shortId, creation.prefix))
            }
          }
        } else {
          console.log(`No metadata found for batch ${shortId}`)
          if (batch.images) {
            const batchEmbedded = []
            for (const imgname of batch.images) {
              const embMeta = await ExtractMetadataFromImage(path.join(pathname, imgname), exiftool)
              batchEmbedded.push(embMeta)
            }
            const creation = Creation.fromExtractedMetadata(batchEmbedded)
            for (const imgObj of creation.images) {
              await doRename(pathname, imgObj.name, creation.getFileName(imgObj))
            }
          }
          if (batch.sourceImage) {
            const embMeta = await ExtractMetadataFromImage(path.join(pathname, batch.sourceImage), exiftool)
            console.log(embMeta)
          }
          

          // in this case (only images), for each image,
          // attempt to extract the metadata IN the image.
          // if you succeed in extracting a "date taken", base its created date on that;
          // otherwise set its created date to the earliest of its file creation/modification date.
          // if the filename contains a space, look at the portion following the first space.
          //    if you extracted a prompt,
          //        if the filename is the start of the prompt, then ignore the filename
          //        else (the filename differs from the prmopt) filename -> title (base future filename on it)
          //    else
          //        filename -> prompt (embed it) AND title (base future filename on it)

          // rename the file as expected based on its creation date and extracted metadata.
        }
      }
      for (const file of unrecognized) {
        console.log(`Unrecognized file ${file}`)
        const embMeta = await ExtractMetadataFromImage(path.join(pathname, file), exiftool)
        console.log(embMeta)
      }
      // are there any files left to process (that were not matched up with a metadata json file)?
      // for each of those,
      //   extract the embedded EXIF metadata, if there is any, and look for a date taken/creation date
      //   use that to rename the file if you have it
      //   otherwise take the file creation or modification date (whichever is earlier) to rename the file
    } catch (e) {
      console.error(e)
    } finally {
      exiftool.end()
    }
  }
}
exports.Controller = Controller

const SIDRE = /^[0-9a-fA-F]+/

async function doRename (dirpath, oldname, newname) {
  if (oldname === newname) return
  if (dryrun) {
    console.log(`rename '${oldname}' to '${newname}'`)
  } else {
    await fsp.rename(path.join(dirpath, oldname), path.join(dirpath, newname))
  }
}

async function doDelete (dirpath, name) {
  if (dryrun) {
    console.log(`delete '${name}'`)
  } else {
    await fsp.unlink(path.join(dirpath, name))
  }
}

async function downloadImage (url, path, headers = undefined) {
  const writer = fs.createWriteStream(path)
  const config = {
    url,
    // method: 'get', // (default)
    responseType: 'stream'
  }
  if (headers) {
    config.headers = headers
  }
  const response = await axios(config)
  response.data.pipe(writer)
  return new Promise((resolve, reject) => {
    writer.on('error', reject)
    writer.on('finish', resolve)
  })
  // const fetchedPromise = new Promise((resolve, reject) => {
  //   fs.createReadStream(filePath)
  //     .pipe(crypto.createHash('sha256'))
  //     .pipe(writer)
  //     .on('error', reject)
  //     .on('finish', function () {
  //       resolve(this.digest('hex'))
  //     })
  // })
  // let hash = await fetchedPromise
  // response.data
  //   .pipe(crypto.createHash('sha256'))
  //   .on('error', reject)
  //   .on('finish', function () {
  //     resolve(this.digest('hex'))
  //   })
  // return ...
}

async function getJson (url, headers = undefined) {
  return axios({
    url,
    // method: 'get', // (default)
    responseType: 'json',
    headers,
  })
}
