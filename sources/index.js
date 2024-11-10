const Civitai = require('./civitai')
const Dezgo = require('./dezgo')
const HappyAccidents = require('./happyaccidents')
const MageSpace = require('./mage')
const StarryAI = require('./starryai')
const NightCafe = require('./nightcafe')
const Unstability = require('./unstability')
const Novita = require('./novita')

function DetectSource(metadata) {
  if (StarryAI.isMatch(metadata)) return StarryAI
  if (Novita.isMatch(metadata)) return Novita
  if (NightCafe.isMatch(metadata)) return NightCafe
  if (Dezgo.isMatch(metadata)) return Dezgo
  if (HappyAccidents.isMatch(metadata)) return HappyAccidents
  if (Unstability.isMatch(metadata)) return Unstability
  if (MageSpace.isMatch(metadata)) return MageSpace
  if (Civitai.isMatch(metadata)) return Civitai
}

module.exports = {
  DetectSource,
  Civitai,
  NightCafe,
  Novita,
  Dezgo,
  HappyAccidents,
  MageSpace,
  StarryAI,
  Unstability,
}
