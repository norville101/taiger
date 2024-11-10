function isMatch (source) {
  return Boolean(source.metadata && source.model_version && source.metadata.model_version && source.blurhash)
}
exports.isMatch = isMatch

async function sourceToCreation (source, creation) {

}
exports.sourceToCreation = sourceToCreation
