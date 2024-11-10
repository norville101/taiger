const fs = require('fs')
const path = require('path')
const axios = require('axios');
const { setTimeout } = require('node:timers/promises')
const { PARAM } = require('../mdparams')
const { RemoteImageFile } = require('../image')
const { GetUrlExtension, GetUrlFilename, FormatLocalDateTimeISO } = require('../utils')
const {
  creationFields, creationV2Fields,
  creationSummaryFields,
  publicCreationFields, publicCreationV2Fields,
  userFields,
  modelFields,
} = require('./starryai_fields')

const stateDir = path.join(__dirname, '..', 'state', 'starryai')
const configPath = path.join(__dirname, '..', 'config', 'starryai.json')
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  : { users: [], headers: {} }

const badQueries = {}

function isMatch (source) {
  return source.sender === 'starRycover' ||
    source.__typename === 'Creation' || source.__typename === 'publicCreation' ||
    source.__typename === 'CreationV2' || source.__typename === 'publicCreationV2'
}

async function sourceToCreation (source, creation, options) {
  creation.createdBy = 'StarryAI'
  const isV2 = source.__typename === 'CreationV2' || source.__typename === 'publicCreationV2'
  creation.id = source.id
  creation.orderById = true
  if (source.createdAt) creation.createdAt = new Date(source.createdAt)
  if (source.publishedAt) {
    creation.publishedAt = new Date(source.publishedAt)
    if (!creation.createdAt) creation.createdAt = creation.publishedAt
  }
  if (source.title) creation.title = source.title
  if (source.link && source.link !== 'null') creation.url = source.link
  if (source.prompts && source.prompts.length > 0) {
    creation.prompts = source.prompts.map(p => {
      const { __typename, ...newPrompt } = p
      return newPrompt
    })
    const weighted = creation.prompts.some(p => p.weight)
    // if weights are present, sort in descending order of weight;
    // otherwise assume positive first and negative last
    if (creation.prompts.length > 1 && weighted) {
      creation.prompts.sort((a, b) => (b.weight || 0) - (a.weight || 0))
    }
    creation.prompt = creation.prompts[0].prompt
    if (creation.prompts.length > 1) {
      if (creation.prompts.length === 2 || !weighted) {
        creation.negativePrompt = creation.prompts[1].prompt
      } else { // this.prompts.length > 2 && weighted
        creation.negativePrompt = creation.prompts[creation.prompts.length - 1].prompt
      }
    }
  }
  if (source.prompt) {
    if (creation.prompt) {
      if (creation.prompt !== source.prompt) {
        console.error('Error: may have parsed prompts array incorrectly!')
      }
    } else {
      creation.prompt = source.prompt
    }
  }
  if (source.negativePrompt) {
    if (creation.negativePrompt) {
      if (creation.negativePrompt !== source.negativePrompt) {
        console.error('Error: may have parsed prompts array incorrectly!')
      }
    } else {
      creation.negativePrompt = source.negativePrompt
    }
  }
  if (!creation.prompt && source.title) {
    creation.prompt = source.title
  }
  if (source.initialImage) creation.sourceImageUrl = source.initialImage

  if (source.iterations) {
    const steps = source.iterations === 50
      ? 'fast'
      : source.iterations === 100
        ? 'standard'
        : source.iterations === 150
          ? 'detailed'
          : source.iterations.toString()
    creation.setParam(PARAM.steps, steps)
  }
  if (source.width && source.height) creation.setParam(PARAM.size, `${source.width}x${source.height}`)
  let seed = source.seed
  if (typeof seed === 'number' && seed >= 0) {
    creation.setParam(PARAM.seed, seed)
  } else {
    seed = extractSeedFromVariations(source.variations)
    if (typeof seed === 'number' && seed >= 0) {
      creation.setParam(PARAM.seed, seed)
    } else {
      seed = extractSeedFromVariations(source.variationsV1)
      if (typeof seed === 'number' && seed >= 0) {
        creation.setParam(PARAM.seed, seed)
      }
    }
  }
  creation.setParam('Service', creation.createdBy)
  if (source.model && source.modelName) {
    if (source.modelName.toLowerCase() === source.model.toLowerCase())
      creation.setParam(PARAM.model, source.modelName)
    else
      creation.setParam(PARAM.model, `${source.modelName} (${source.model})`)
  } else if (source.model) {
    creation.setParam(PARAM.model, source.model)
  } else if (source.modelName) {
    creation.setParam(PARAM.model, source.modelName)
  }

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
          var numPart = isV2 ? 2 : 1
          if (isNaN(idparts[numPart]) && idparts.length - 1 > numPart) {
            numPart = idparts.length - 1
          }
          if (!isNaN(idparts[numPart])) {
            newImg.imageNumber = Number.parseInt((newImg.fnImageNum = idparts[numPart]))
            lastImageNum = newImg.imageNumber
          } else {
            throw new Error('Unable to extract image number from: ' + img.id)
          }
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
            // if (img.enhanceSettings?.prompt) {
            //   newImg.fnScale += ' ' + img.enhanceSettings?.prompt
            // }
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
  if (source.upscales && source.upscales.length > 0) {
    if (!creation.images) creation.images = []
    source.upscales
      .filter(upsc => upsc.status === 'Complete')
      .forEach(upsc => {
        const urlExt = GetUrlExtension(upsc.url) || '.png'
        const newImg = new RemoteImageFile(upsc.url, urlExt)
        newImg._orig_meta = upsc
        //const origVar = source.variations.find(v => v.id === upsc.variationId)
        const idparts = upsc.variationId.split('-')
        newImg.fnPrefix = newImg.reelName = idparts[0] // no op
        newImg.imageNumber = Number.parseInt((newImg.fnImageNum = idparts[1]))
        newImg.fnScale = String(upsc.factor)
        newImg.uniqueId = path.basename(GetUrlFilename(upsc.url), urlExt).replace(/\-/g, '')
        newImg.createdAt = new Date(upsc.createdAt || upsc.updatedAt)
        creation.images.push(newImg)
      })
  }
}

function extractSeedFromVariations (variations) {
  if (variations && variations.length) {
    const v = variations.find(v => v.seed)
    return (v && v.seed >= 0) ? v.seed : undefined
  }
}

function summarizeCreation(creation) {
  const parts = []
  parts.push(FormatLocalDateTimeISO(new Date(creation.createdAt)))
  let compliant = 'C'
  if (('compliant' in creation) && !creation.compliant) compliant = 'N'
  if (creation.suggestive) compliant += 's'
  parts.push(compliant)
  let variations = 'v'
  let published = 'p'
  let nsfw = 'n'
  let upscales = 'u'
  if (creation.variations) {
    for (const v of creation.variations) {
      let vNum = v.id.slice(-1)
      variations += vNum
      if (v.saved) published += vNum // TODO: very old creations have v.saved==true when not published. Look at creation.public too?
      if (v.nsfw) nsfw += vNum
      if (creation.upscales?.some(u => (
        u.variationId
          ? u.variationId === v.id
          : u.photo
            ? u.photo.toString() === vNum
            : ('index' in u)
              ? (u.index + 1).toString() === vNum
              : false
      ))) {
        upscales += vNum
      }
    }
  }
  parts.push(variations)
  if (upscales !== 'u') parts.push(upscales)
  if (published !== 'p') parts.push(published)
  if (nsfw !== 'n') parts.push(nsfw)
  return parts.join('/')
}

/*
  Interesting queries supported by starryai's GraphQL API:
    user -- gets information about the current user
    creation -- if you know the id of an individual creation of the current user, get its metadata
    creations -- browses through the list of the current user's past creations
    projectCreations -- browses through the list of the current user's creations in a specific project
    profileCreations -- gets a list of the current user's published creations AND LIKED creations!
    publicCreation -- if you know the id of an individual public creation, get its metadata
    publicUserCreations -- gets a list of all of a specific public user's published creations
    likedCreations -- not sure the difference between this and what's available in profileCreations
  
  Things I'd like to do:
    - keep track, per user account, of
       + "my" most recently downloaded creations (alternatively, all of "my" downloaded creations?)
       + all "liked" creations (and which have been downloaded)
       + all "my" published creations, and which have the most "likes"??
    - automatically build list of my not-yet-downloaded creations,
      query all relevant/available metadata on them,
      then auto-download based on that list
    - automatically build list of my not-yet-downloaded "liked" publicCreations,
      query all relevant/available metadata on them,
      then auto-download based on that list
    - publish specific variations that cannot be done using their web interface
    - also delete specific variations, which cannot be done " " " "
*/

async function getCurrentUser (authToken) {
  const operation = 'user'
  let data = JSON.stringify({
    query: `query User {
        ${operation} {${userFields}}
      }`,
    variables: {}
  })
  return doGraphQL(data, authToken, operation)
}

async function getNewLikedPublicCreations (authToken, ignoreOwn = false) {
  // use authToken to get the current user
  const user = await getCurrentUser(authToken)
  const userId = user.id
  // read this user's "liked" cache, if it exists
  const cacheName = path.join(stateDir, `${userId}.liked_list.json`)
  let cache
  if (fs.existsSync(cacheName)) {
    const str = fs.readFileSync(cacheName)
    cache = JSON.parse(str)
  } else {
    cache = {}
  }
  // retrieve likedCreations for this user, going back until we encounter one that has already been cached
  // (otherwise it goes all the way back to the first like)
  const newLikes = []
  let page = 0
  let done = false
  let pageResults
  do {
    pageResults = await getLikedPublicCreationsPage(page * 10, 10, authToken)
    if (pageResults && pageResults.length > 0) {
      for (const thisResult of pageResults) {
        if (thisResult.id in cache) {
          done = true
        } else {
          newLikes.push(thisResult)
        }
      }
      if (!done) {
        page++
        await setTimeout(1000) // avoid calling too rapidly; space it out
      }
    } else {
      done = true
    }
  } while (!done)
  const filteredResult = []
  // update the cache to include all the new creationIds and save it; also filter if requested
  if (newLikes.length > 0) {
    const ignoreAlso = Object.keys(config.users)
    const otherCaches = {}
    for (const otherCacheId of ignoreAlso.filter(ignoreId => ignoreId !== userId)) {
      const otherCacheName = path.join(stateDir, `${otherCacheId}.liked_list.json`)
      if (fs.existsSync(otherCacheName)) {
        const str = fs.readFileSync(otherCacheName)
        Object.assign(otherCaches, JSON.parse(str))
      }
    }
    for (let i = newLikes.length - 1; i >= 0; i--) {
      let thisLike = newLikes[i]
      cache[thisLike.id] = thisLike.link
      if (ignoreAlso.includes(thisLike.publisher.id) // thisLike's publisher was excluded
        || (ignoreOwn && (thisLike.publisher.id === userId)) // thisLike was published BY userId
        || (thisLike.id in otherCaches) // thisLike was already liked by an excluded publisher
      ) {
        // ignore this "like"
      } else {
        filteredResult.push(thisLike)
      }
    }
    fs.writeFileSync(cacheName, JSON.stringify(cache))
  }
  // for each of the filtered new likes, check for hidden properties and also call V1 of the API
  // to ensure we retrieve as much metadata as possible from previous API leaks
  for (const pc of filteredResult) {
    await extendPublicCreationV2Metadata(pc, authToken)
  }
  return filteredResult
}

async function getLikedPublicCreationsPage (offset, limit, authToken) {
  const operation = 'likedCreationsV2'
  console.log(`(retrieving LikedCreationsV2 ${offset}-${offset + limit - 1})`)
  let data = JSON.stringify(
    {
      query: `query LikedCreationsV2($limit: Int, $offset: Int!) {
          ${operation}(
            limit: $limit
            offset: $offset
          ) {${publicCreationV2Fields}
          }
        }`,
      variables: {
        offset,
        limit,
      }
    }
  )
  return doGraphQL(data, authToken, operation)
}

const rePublic = /\/user\/(\w+)\/creation\/(\d+)/
const rePrivate = /\/my-creations\/(\d+)/

async function getCreationMetadata (url, authToken) {
  let results
  if ((results = rePublic.exec(url))) { // it's a public creation
    return getPublicCreationV2Metadata(results[2], authToken)
  }
  if ((results = rePrivate.exec(url))) { // it's a private creation
    return getPrivateCreationV2Metadata(results[1], authToken)
  }
}

async function getPublicCreationMetadata (creationId, authToken) {
  const operation = 'publicCreation'
  let data = JSON.stringify({
    query: `query ArtistCreation($bigCreationId: BigInt!) {
        ${operation}(bigCreationId: $bigCreationId) {${publicCreationFields}
        }
      }`,
    variables: { bigCreationId: creationId }
  })
  return doGraphQL(data, authToken, operation)
}

async function getPublicCreationV2Metadata (creationId, authToken) {
  const operation = 'publicCreationV2'
  let data = JSON.stringify({
    query: `query PublicCreationV2($creationId: BigInt!) {
        ${operation}(creationId: $creationId) {${publicCreationV2Fields}
        }
      }`,
    variables: { creationId }
  })
  const result = await doGraphQL(data, authToken, operation)
  if (result) {
    await extendPublicCreationV2Metadata(result, authToken, 4500)
  }
  return result
}

async function extendPublicCreationV2Metadata (publicCreationV2, authToken, delay = 1000) {
  const pc = publicCreationV2
  if (pc && pc.hideSettings && !pc.prompts && !pc.prompt) {
    console.log(`Creation ${pc.id} has hidden settings; trying to retrieve prompt, seed, etc.`)
    // try again with V1 API, which happens to leak prompts (though negative prompts & init images are still hidden)
    // update: as of March 2024, StarryAI has apparently removed the v1 API! :-(
    //         but I'll keep the code in here in case they revert it in the future.
    await setTimeout(delay) // avoid calling too rapidly; space it out
    const try2 = await getPublicCreationMetadata(pc.id, authToken)
    if (try2) {
      pc.prompt = try2.prompt
      pc.variationsV1 = try2.variations
    }
  }
}

async function getPrivateCreationMetadata (creationId, authToken) {
  const operation = 'creation'
  let data = JSON.stringify({
    query: `fragment Creation on Creation {${creationFields}
      }
      query Creation($bigCreationId: BigInt!) {
        ${operation}(bigCreationId: $bigCreationId) {
          ...Creation
          __typename
        }
      }`,
    variables: { "bigCreationId": creationId },
  })
  return doGraphQL(data, authToken, operation)
}

async function getPrivateCreationV2Metadata (creationId, authToken) {
  const operation = 'creationV2'
  let data = JSON.stringify({
    query: `fragment CreationV2 on CreationV2 {${creationV2Fields}
      }
      query CreationV2($creationId: BigInt!) {
        ${operation}(creationId: $creationId) {
          ...CreationV2
          __typename
        }
      }`,
    variables: { "creationId": creationId },
  })
  return doGraphQL(data, authToken, operation)
}

async function getAllCreationMetadataSince (url, authToken) {
  const urlInfo = rePrivate.exec(url)
  if (urlInfo) {
    return getCreationsNewerThan(urlInfo[1], authToken)
  }
}

async function getCreationsNewerThan (creationId, authToken) {
  // retrieve creations of this user, going back until we encounter backToId
  const newCreations = []
  let page = 0
  let done = false
  let pageResults
  do {
    pageResults = await getPrivateCreationsV2Page(authToken, page * 10, 10, 'recent', creationV2Fields)
    if (pageResults && pageResults.length > 0) {
      for (const thisResult of pageResults) {
        if (thisResult.id === creationId) {
          done = true
          break
        } else {
          newCreations.push(thisResult)
        }
      }
      if (!done) {
        page++
        await setTimeout(1000) // avoid calling too rapidly; space it out
      }
    } else {
      done = true
    }
  } while (!done)
  return newCreations
}

async function getAllPublishedCreations (authToken) {
  // use authToken to get the current user
  const user = await getCurrentUser(authToken)
  const userId = user.id
  const timestr = FormatLocalDateTimeISO(new Date(), true).replace(/:/g, '⁚')
  const cacheName = path.join(stateDir, `${userId}.${timestr}.all_published_metadata.json`)
  // retrieve published creations of this user, going all the way back
  const creations = await getAllCreations(authToken, 'published', creationV2Fields, 50, 2000)
  // cache on disk for later analysis
  await fs.promises.writeFile(cacheName, JSON.stringify(creations, undefined, 2), )
  // also transform/simplify to "likes" CSV and write that as well
  let likecsv = []
  let total = 0
  for (const item of creations) {
    likecsv.unshift(`${item.id},${item.publishedAt},"${item.title}",${item.likes}`)
    total += item.likes
  }
  likecsv.unshift(`,,"Total Likes:",${total}`)
  likecsv.unshift(`id,publishedAt,title,likes${timestr.slice(2,10)}`)
  const summaryName = path.join(stateDir, `${userId}.${timestr}.new_published_summary.csv`)
  await fs.promises.writeFile(summaryName, '\uFEFF' + likecsv.join('\n'))
  return creations
}

async function getAllSummaryCreations (authToken) {
  // use authToken to get the current user
  const user = await getCurrentUser(authToken)
  const userId = user.id
  const timestr = FormatLocalDateTimeISO(new Date(), true).replace(/:/g, '⁚')
  // retrieve published creations of this user, going all the way back
  const creations = await getAllCreations(authToken, 'recent', creationSummaryFields, 50, 2000)
  // for testing:
  // const creations = await getPrivateCreationsPage(authToken, 10, 10, 'recent', creationSummaryFields)
  // build index
  let index = {}
  for (const item of creations) {
    index[item.id] = summarizeCreation(item)
  }
  // cache on disk for later usage
  const cacheName = path.join(stateDir, `${userId}.${timestr}.creation_summary.json`)
  await fs.promises.writeFile(cacheName, JSON.stringify(index, undefined, 2))
  return creations.length
}

async function getAllCreations (authToken, filter, fields, pageSize, delay) {
  // retrieve published creations of this user, going all the way back
  const creations = []
  let page = 0
  let done = false
  let pageResults
  do {
    pageResults = await getPrivateCreationsV2Page(authToken, page * pageSize, pageSize, filter, fields)
    if (!pageResults || !pageResults.length) {
      done = true
      break
    }
    creations.push(...pageResults)
    if (pageResults.length < pageSize) {
      done = true
      break
    }
    if (!done) {
      page++
      await setTimeout(delay) // avoid calling too rapidly; space it out
    }
  } while (!done)
  return creations
}

async function getPrivateCreationsPage (authToken, offset, limit, filter = 'recent', fields) {
  const operation = 'creations'
  // filter is one of: 'all', 'published', 'unpublished', 'upscaled', 'removedBg', 'recent', 'notInAProject'
  console.log(`(retrieving ${filter} Creations ${offset}-${offset + limit - 1})`)
  let data = JSON.stringify(
    {
      query: `query Creations($filter: String!, $limit: Int, $model: String, $offset: Int!, $projectId: Int) {
          ${operation}(
            filter: $filter
            limit: $limit
            model: $model
            offset: $offset
            projectId: $projectId
          ) {${fields}
          }
        }`,
      variables: {
        offset,
        limit,
        filter,
      }
    }
  )
  return doGraphQL(data, authToken, operation)
}

async function getPrivateCreationsV2Page (authToken, offset, limit, filter = 'recent', fields) {
  const operation = 'creationsV2'
  // filter is one of: 'all', 'published', 'unpublished', 'upscaled', 'removedBg', 'recent', 'notInAProject'
  console.log(`(retrieving ${filter} CreationsV2 ${offset}-${offset + limit - 1})`)
  let data = JSON.stringify(
    {
      query: `query CreationsV2($filter: String!, $limit: Int, $model: String, $offset: Int!, $projectId: Int) {
          ${operation}(
            filter: $filter
            limit: $limit
            model: $model
            offset: $offset
            projectId: $projectId
          ) {${fields}
          }
        }`,
      variables: {
        offset,
        limit,
        filter,
      }
    }
  )
  return doGraphQL(data, authToken, operation)
}

async function getNewModels (authToken) {
  // read the models cache, if it exists
  const cacheName = path.join(stateDir, `models.published.index.json`)
  let cache
  if (fs.existsSync(cacheName)) {
    const str = fs.readFileSync(cacheName)
    cache = JSON.parse(str)
  } else {
    cache = {}
  }
  // retrieve models page by page, going back until we encounter one that has already been cached
  // (otherwise it goes back as far as it's able to)
  const newModels = [] // will be in reverse chronological order (newest first)
  let page = 0
  let done = false
  let pageResults
  do {
    pageResults = await getModelsPage(authToken, page * 15, 15, 'ALL', 'NEWEST', false, modelFields)
    if (pageResults && pageResults.length > 0) {
      for (const thisResult of pageResults) {
        if (thisResult.id in cache) {
          done = true
        } else {
          newModels.push(thisResult)
        }
      }
      if (!done) {
        page++
        await setTimeout(2000) // avoid calling too rapidly; space it out
      }
    } else {
      done = true
    }
  } while (!done)
  if (newModels.length > 0) {
    // write the newly fetched model info out to a file (for later analysis)
    const timestr = FormatLocalDateTimeISO(new Date(), true).replace(/:/g, '⁚')
    const newfile = path.join(stateDir, `models.published.new.${timestr}.json`)
    await fs.promises.writeFile(newfile, JSON.stringify(newModels, undefined, 2), )

    // update the cache to include all the new models and save it
    for (let i = newModels.length - 1; i >= 0; i--) { // oldest to newest
      let thisModel = newModels[i]
      cache[thisModel.id.toString()] = `${thisModel.label} (${thisModel.subCategory})`
    }
    fs.writeFileSync(cacheName, JSON.stringify(cache))
  }
  return newModels
}

async function getModelsPage (authToken, offset, limit, subCategory = 'ALL', sortBy = 'NEWEST', savedOnly = false, fields) {
  const operation = 'publicModels'
  // subCategory is one of: 'ALL', 'ART', 'PORTRAITS', 'CHARACTERS', 'ILLUSTRAIONS', 'ILLUSTRATIONS', 'PHOTOGRAPHY'
  // sortBy is one of: 'MOST_USED', 'MOST_SAVED', 'NEWEST'
  console.log(`(retrieving ${sortBy} ${
    subCategory === 'ALL' ? '' : subCategory + ' '}PublicModels ${offset}-${offset + limit - 1})`)
  let data = JSON.stringify(
    {
      query: `query PublicModels($limit: Int, $offset: Int, $savedOnly: Boolean, $sortBy: Models_Sort_By, $subCategory: Style_Sub_Category) {
        ${operation}(
          limit: $limit
          offset: $offset
          savedOnly: $savedOnly
          sortBy: $sortBy
          subCategory: $subCategory
        ) {${fields}
        }
      }`,
      variables: {
        sortBy,
        savedOnly,
        subCategory,
        offset,
        limit,
      }
    }
  )
  return doGraphQL(data, authToken, operation)
}

async function doGraphQL (data, authToken, operation) {
  if (!operation) throw new Error('Required \'operation\' parameter missing')
  if (badQueries[operation]) {
    console.log(`Skipped '${operation}' due to prior failure`)
    return
  }
  config.headers['authorization'] = authToken
  try {
    const response = await axios({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://app.starryai.com/graphql',
      headers: config.headers,
      data,
    })
    if (response) {
      const rspData = response.data
      if (rspData) {
        if (rspData.errors && rspData.errors.length > 0) {
          console.error(rspData.errors.map(e => typeof e === 'object' ? e.message : e.toString()).join('\n'))
        }
        return rspData.data && rspData.data[operation]
      }
    }
  } catch (e) {
    let message = e.response?.data?.errors?.map(err => err.message + ' ' + JSON.stringify(err.locations)).join('\n')
      || e.code || `${e.name}: ${e.message}`
    if (e.stack) message += '\n' + e.stack
    console.error(message)
    if (e.code === 'ERR_BAD_REQUEST' && e.response.status === 400 && message.includes(operation)) {
      // for now, stop making this specific kind of query
      badQueries[operation] = true
    }
  }
}

async function deleteVariation (authToken, url, varNum) {
  const operation = 'deleteVariations'
  const urlInfo = rePrivate.exec(url)
  if (!urlInfo) return
  const creationId = urlInfo[1]
  let data = JSON.stringify({
    query: `mutation DeleteVariations($creationId: BigInt!, $variationIds: [String]!) {
        ${operation}(
          creationId: $creationId
          variationIds: $variationIds
        ) {
          creation {
            finalUrl
            hideSettings
            id
            keyPhoto
            link
            public
            thumbnail
            title
            __typename
          }
          success
          __typename
        }
      }`,
    variables: {
      creationId,
      variationIds: [`${creationId}-${varNum}`],
    }
  })
  return doGraphQL(data, authToken, operation)
}

async function publishVariations (authtoken, creationId, hideSettings, publish, title, variationIds) {
  const operation = 'publishCreation'
  let data = JSON.stringify({
    query: `mutation PublishCreation($bigCreationId: BigInt!, $hideSettings: Boolean, $publish: Boolean, $title: String, $variationIds: [String]) {
        ${operation}(
          bigCreationId: $bigCreationId
          hideSettings: $hideSettings
          publish: $publish
          title: $title
          variationIds: $variationIds
        ) {
          creation {
            finalUrl
            hideSettings
            id
            keyPhoto
            link
            public
            thumbnail
            title
            __typename
          }
          success
          __typename
        }
      }`,
    variables: {
      bigCreationId: creationId,
      title,
      hideSettings,
      publish,
      variationIds,
    }
  })
  return doGraphQL(data, authToken, operation)
}

async function claimCredits (authToken) {
  const operation = 'claimCredits'
  let data = JSON.stringify({
    query: `mutation ClaimCredits($type: String!) {
        ${operation}(
          type: $type
        ) {
          user {
            availableRewards
            credits
            creditsResetAt
            dailyCredits
            email
            fastCredits
            id
            provider
            reputation
            totalCredits
            userName
            __typename
          }
          success
          __typename
        }
      }`,
    variables: {
      type: 'adsReward'
    }
  })
  return doGraphQL(data, authToken, operation)
}

module.exports = {
  isMatch,
  sourceToCreation,
  getCurrentUser,
  getNewLikedPublicCreations,
  getCreationMetadata,
  getAllCreationMetadataSince,
  getCreationsNewerThan,
  getAllPublishedCreations,
  getAllSummaryCreations,
  getNewModels,
  deleteVariation,
  claimCredits,
}
