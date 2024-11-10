function IsFireBaseRaw (str) {
  const chunk = str.slice(0, 20)
  return chunk.match(/^\d+\s\[/)
}

function FireBaseDocuments (str, docType = 'jobs') {
  const start = str.indexOf('[')
  const chunks = str.slice(start).split(/\]\d+\s\[/)
  chunks[0] = '[' + chunks[0]
  chunks[chunks.length - 1] += ']'
  const jsonStr = chunks.join(',')
  const json = JSON.parse(jsonStr)
  const docs = ExtractDocuments(json, `/documents/${docType}/`)
  return docs
}

function ExtractDocuments (array, docTypeStr, result = undefined) {
  if (!result) {
    result = []
  }
  for (const element of array) {
    if (Array.isArray(element)) {
      ExtractDocuments(element, docTypeStr, result)
    } else if (typeof element === 'object' && element.documentChange) {
      const raw = element.documentChange.document
      const docName = raw?.name
      if (docName && docName.includes(docTypeStr)) {
        const doc = ExtractObject(raw.fields)
        if (doc) {
          result.push(doc)
        }
      }
    }
  }
  return result
}

function ExtractObject (fields) {
  const result = {}
  for (const [key, value] of Object.entries(fields)) {
    result[key] = ExtractValue(value)
  }
  return result
}

function ExtractValue (value) {
  if ('stringValue' in value)
    return value.stringValue
  else if ('booleanValue' in value)
    return value.booleanValue
  else if ('integerValue' in value)
    return value.integerValue
  else if ('doubleValue' in value)
    return value.doubleValue
  else if ('timestampValue' in value)
    return (new Date(value.timestampValue)).valueOf()
  else if ('arrayValue' in value)
    return value.arrayValue?.values?.map(vo => ExtractValue(vo))
  else if ('mapValue' in value)
    return ExtractObject(value.mapValue?.fields)
  throw new Error('Unrecognized value type')
}

module.exports = {
  IsFireBaseRaw,
  FireBaseDocuments,
}
