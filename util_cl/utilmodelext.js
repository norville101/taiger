const { setTimeout } = require('node:timers/promises')
const fs = require('fs')
const fsp = fs.promises
const { Civitai } = require('../sources')

const ExtendModels = module.exports.ExtendModels = async function(filepath) {
  try {
    // read json file
    const content = await fsp.readFile(filepath, 'utf-8')
    const models = JSON.parse(content)
    let num = 0
    // for each model in it...
    for (const model of models) {
      if (model.download_url.startsWith('https://civitai.com/')) {
        console.log(`extending model #${++num}, model-version ${model.id}`)
        await ExtendModel(model)
      } else {
        console.log(`skipping model #${++num}, id ${model.id}, url: ${model.download_url}`)
      }
    }
    console.log('writing backup file & saving results')
    fs.renameSync(filepath, filepath + '.bak') // silently replaces any existing backup
    await fsp.writeFile(filepath, JSON.stringify(models))
  }
  catch (e) {
    console.error(e)
  }
}

async function ExtendModel (model, delay = 1000) {
  await setTimeout(delay)
  // look up modelversion in civitai
  let ext
  try {
    ext = await Civitai.fetchModelByModelVersionId(model.id)
  } catch (e) {
    console.log(e.message)
  }
  if (ext) {
    // add select additional info from civitai into model definition
    model.civitai_meta = {
      modelId: ext.modelId, // civitai model ID (as opposed to only model-version id)
      air: ext.air,
      model: ext.model,
      createdAt: ext.createdAt,
      updatedAt: ext.updatedAt,
      publishedAt: ext.publishedAt,
      // images: ext.images, // too much data, unnecessary
    }
  }
}