exports.creationFields = `
aspectRatio
compliant
createdAt
finalUrl
height
id
initImageMode
initialImage
imageStrength
isCustomModel
iterations
likes
link
method
model
modelName
projectId
prompt
prompts {
  prompt
  weight
  __typename
}
public
publishedAt
remixedFrom
saved
seed
status
suggestive
thumbnail
title
updatedAt
upscales {
  createdAt
  factor
  id
  index
  photo
  status
  updatedAt
  url
  variationId
  __typename
}
variations {
  compressed
  id
  nsfw
  saved
  seed
  url
  __typename
}
width
__typename
`

exports.creationV2Fields = `
id
prompt
model
width
height
seed
initialImage
initImageMode
createdAt
updatedAt
public
title
likes
iterations
enhancedPrompts
hideSettings
publishedAt
imageStrength
compliant
variations {
  id
  url
  compressed
  saved
  public
  nsfw
  type
  status
  expiresAt
  initImage
  enhanceSettings {
    prompt
    level
    style
    __typename
  }
  upscaleSettings {
    factor
    __typename
  }
  __typename
}
projectId
indexed
thumbnail
prompts {
  prompt
  weight
  __typename
}
aspectRatio
link
modelName
modelId
isCustomModel
isOwner
__typename
`

exports.creationSummaryFields = `
compliant
createdAt
id
likes
public
publishedAt
saved
status
suggestive
thumbnail
updatedAt
upscales {
  id
  index
  photo
  status
  variationId
}
variations {
  id
  nsfw
  saved
}
`

exports.publicCreationFields = `
aspectRatio
createdAt
finalUrl
height
hideSettings
id
indexed
initialImage
initImageMode
initImageModel
isOwner
iterations
liked
likes
link
method
model
modelName
prompt
prompts {
  prompt
  weight
  __typename
}
publishedAt
publisher {
  id
  profileThumb
  userName
  __typename
}
seed
thumbnail
title
variations {
  compressed
  id
  nsfw
  saved
  seed
  url
  __typename
}
width
__typename
`

exports.publicCreationV2Fields = `
id
model
width
height
seed
initialImage
initImageMode
createdAt
title
likes
iterations
hideSettings
publishedAt
variations {
  id
  url
  compressed
  saved
  public
  nsfw
  type
  status
  expiresAt
  initImage
  enhanceSettings {
    prompt
    level
    style
    __typename
  }
  upscaleSettings {
    factor
    __typename
  }
  __typename
}
indexed
publisher {
  id
  profileThumb
  userName
  __typename
}
liked
thumbnail
prompts {
  prompt
  weight
  __typename
}
aspectRatio
isOwner
link
initImageModel
modelName
modelId
isCustomModel
__typename
`

exports.userFields = `
about
availableRewards
badges {
  badgeName
  id
  __typename
}
creditPacks {
  available
  id
  source
  __typename
}
credits
creditsResetAt
dailyCredits
deletedAt
features
followers
following
id
instagramHandle
intercomUserHash
likes
premium
premiumExpiryDate
profileThumb
proProduct
proVersion
provider
redditHandle
stripeSubscriptionStatus
tiktokHandle
twitterHandle
userName
website
webSocketUrl
__typename
`

exports.modelFields = `
id
label
value
thumbnail
cover
status
custom
public
category
subCategory
base
proOnly
baseCost
saved
trainingCompletes
usesCount
savesCount
description
publishedAt
isOwner
publisher {
  id
  userName
  profileThumb
  isFollowed
  profilePhoto
  isPro
  __typename
}
__typename
`
