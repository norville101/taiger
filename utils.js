const crypto = require('crypto')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')

function EscapeFileName (filename) {
  return filename.replace(/[/\\?%*:|"<>\n]/g, '-')
}
exports.EscapeFileName = EscapeFileName

function TrimForTitle (prompt) {
  // replace any amt of whitespace with single space
  let temp = prompt.replace(/\s+/g, ' ')
  // replace some things with hyphens
  temp = temp.replace(/[/\\|]+/g, '-')
  // remove some stuff altogether
  temp = temp.replace(/(<lora:.*?>|:\s*[0-9.]+|[(?%*"<>])/g, '')
  // replace other stuff with commas
  temp = temp.replace(/[),;:]+\s+/g, ',')
  // replace any leftover colons with hyphens
  temp = temp.replace(/:/g, '-')
  // split on commas, then trim and recombine
  return temp.split(',').map(s => s.trim()).filter(Boolean).join(', ')
}
exports.TrimForTitle = TrimForTitle

function GetUrlExtension (urlstr) {
  return path.extname(GetUrlFilename(urlstr))
}
exports.GetUrlExtension = GetUrlExtension

function GetUrlFilename (urlstr) {
  const url = new URL(urlstr)
  return url.pathname.split('/').pop()
}
exports.GetUrlFilename = GetUrlFilename

function GetFilenameExtension (namestr) {
  return path.extname(namestr)
}
exports.GetFilenameExtension = GetFilenameExtension

const suffixRE = /(\d+)\.\w+$/

function GetFilenameSuffix (namestr) {
  const result = suffixRE.exec(namestr)
  return result && result[1]
}
exports.GetFilenameSuffix = GetFilenameSuffix

function StrToNum (numstr, offset) {
  const num = Number.parseInt(numstr)
  if (typeof offset === 'number') {
    return num + offset
  }
  return num
}
exports.StrToNum = StrToNum

const base32 = {
  charset: 'aäbcdeëfghiïjklmnoöpqrstuüvwxyÿz'.split(''),
  encode: integer => {
    if (integer === 0) {
      return 0
    }
    let s = [];
    while (integer > 0) {
      s = [base32.charset[integer % 32], ...s]
      integer = Math.floor(integer / 32)
    }
    return s.join('')
  },
  decode: chars => chars.split('').reverse().reduce((prev, curr, i) =>
    prev + (base32.charset.indexOf(curr) * (32 ** i)), 0)
}
exports.Base32 = base32

function TimeCode32 (time) {
  // Subtract timestamp for 1 Jan 2020, because no need to encode dates prior to that time.
  // Dates prior to 23 Jan 2021 require fewer than 6 base-32 digits, which is fine because no need for them either.
  // 6-digit date stamps cover the time period between 23 Jan 2021 - 9 Jan 2054
  // at a resolution of 1 second.
  return (time && base32.encode(TimeCodeNum(time))) || ''
}
exports.TimeCode32 = TimeCode32

function TimeFromCode32 (timecode) {
  return TimeFromCodeNum(base32.decode(timecode))
}
exports.TimeFromCode32 = TimeFromCode32

function TimeCodeNum (time) {
  return (time && (Math.trunc(time.valueOf()/1000) - 1577862000)) || 0
}
exports.TimeCodeNum = TimeCodeNum

function TimeFromCodeNum (timecode) {
  if (typeof timecode === 'string') {
    timecode = parseFloat(timecode)
  }
  // timecode == number of seconds since 1 Jan 2020
  // so add 1577862000 to get number of seconds since epoch,
  // then multiply by 1000 to get number of milliseconds since epoch
  return new Date((timecode + 1577862000) * 1000)
}
exports.TimeFromCodeNum = TimeFromCodeNum

function TimeCodeHR (time) {
  const numbers = [
    time.getFullYear()%100,
    time.getMonth()+1,
    time.getDate(),
    time.getHours(),
    time.getMinutes(),
    time.getSeconds(),
  ].map(n => n.toString().padStart(2, '0'))
  return numbers.slice(0, 3).join('') + '-' + numbers.slice(3).join('꞉')
}
exports.TimeCodeHR = TimeCodeHR

function EscapeFileName (name) {
  return name
  .replace('/', '⧸')
  .replace('\\', '⧹')
  .replace('?', '¿')
  .replace('*', '∗')
  .replace(':', '꞉')
  .replace('|', '∣')
  .replace('"', '\'')
  .replace('<', '˂')
  .replace('>', '˃')
}
exports.EscapeFileName = EscapeFileName

function ZeroPad (num, digits = 2) {
  return num.toString().padStart(digits, '0')
}
exports.ZeroPad = ZeroPad

function FormatLocalDateTimeANTZ (date) {
  if (!date) return
  const result = []
  result.push(date.getFullYear())
  result.push('-')
  result.push(ZeroPad(date.getMonth() + 1))
  result.push('-')
  result.push(ZeroPad(date.getDate()))
  result.push('T')
  result.push(ZeroPad(date.getHours()))
  result.push(':')
  result.push(ZeroPad(date.getMinutes()))
  result.push(':')
  result.push(ZeroPad(date.getSeconds()))
  return result.join('')
}
exports.FormatLocalDateTimeANTZ = FormatLocalDateTimeANTZ

function FormatLocalDateTimeZone (date) {
  if (!date) return
  const tzo = -date.getTimezoneOffset()
  const dif = tzo >= 0 ? '+' : '-'
  return dif + ZeroPad(Math.floor(Math.abs(tzo) / 60))
    + ':' + ZeroPad(Math.abs(tzo) % 60)
}
exports.FormatLocalDateTimeZone = FormatLocalDateTimeZone

function FormatLocalDateTimeISO(date, includeTimeZone = true) {
  if (!date) return
  return FormatLocalDateTimeANTZ(date) + (
    includeTimeZone ? FormatLocalDateTimeZone(date) : ''
  )
}
exports.FormatLocalDateTimeISO = FormatLocalDateTimeISO

async function DecodeBase64ToFile(base64str, filename) {
  var buf = Buffer.from(base64str, 'base64')
  await fsp.writeFile(filename, buf)
}
exports.DecodeBase64ToFile = DecodeBase64ToFile

// return new Promise((resolve, reject) => {
//   writer.on('finish', resolve)
//   writer.on('error', reject)
// })

function createHashFromFile (filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}
exports.createHashFromFile = createHashFromFile

function createHashFromFile2 (filePath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(crypto.createHash('sha256'))
      .on('error', reject)
      .on('finish', function () {
        resolve(this.digest('hex'))
      })
  })
}
exports.createHashFromFile2 = createHashFromFile2

async function createHashFromFile3(filename) {
  const hash = crypto.createHash('sha256')
  const input = fs.createReadStream(filename)
  input.on('readable', () => {
    const data = input.read()
    if (data)
      hash.update(data)
    else {
      console.log(`${hash.digest('hex')} ${filename}`);
    }
  })
}
exports.createHashFromFile3 = createHashFromFile3

// async function hashOfStream(readable) {
//   return await once(
//     readable.pipe(crypto.createHash('sha256').setEncoding('hex')),
//     'finish'
//   )
// }
