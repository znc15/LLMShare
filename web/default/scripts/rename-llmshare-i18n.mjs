import fs from 'node:fs'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

// 旧 key(美分) -> 新 key(美元)。值：en 用新 key 本身，zh 用中文。
const RENAMES = {
  'Hourly Budget Pool (cents)': {
    newKey: 'Hourly Budget Pool (USD)',
    zh: '每小时预算池（美元）',
  },
  'Total USD-cents split across all users each hour (B)': {
    newKey: 'Total USD split across all users each hour (B)',
    zh: '每小时在所有用户之间分配的总金额（美元，对应公式中的 B）',
  },
  'Per-User Floor (cents)': {
    newKey: 'Per-User Floor (USD)',
    zh: '每位用户保底额度（美元）',
  },
  'Per-User Cap (cents)': {
    newKey: 'Per-User Cap (USD)',
    zh: '每位用户上限（美元）',
  },
  'Channel Daily Cap (cents)': {
    newKey: 'Channel Daily Cap (USD)',
    zh: '渠道每日上限（美元）',
  },
  'Per-channel USD-cents spend limit per day': {
    newKey: 'Per-channel USD spend limit per day',
    zh: '单个渠道每天的消费上限（美元）',
  },
  'Channel Hourly Cap (cents)': {
    newKey: 'Channel Hourly Cap (USD)',
    zh: '渠道每小时上限（美元）',
  },
  'Per-channel USD-cents spend limit per hour (0 = off)': {
    newKey: 'Per-channel USD spend limit per hour (0 = off)',
    zh: '单个渠道每小时的消费上限（美元，0 表示关闭）',
  },
}

function readJson(f) {
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}
function writeJson(f, obj) {
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

function apply(localeFile, isEn) {
  const full = path.join(LOCALES_DIR, localeFile)
  const json = readJson(full)
  const trans = json.translation || (json.translation = {})
  let removed = 0
  let added = 0
  for (const [oldKey, spec] of Object.entries(RENAMES)) {
    if (trans[oldKey] !== undefined) {
      delete trans[oldKey]
      removed++
    }
    if (trans[spec.newKey] === undefined) {
      trans[spec.newKey] = isEn ? spec.newKey : spec.zh
      added++
    }
  }
  writeJson(full, json)
  return { removed, added }
}

const en = apply('en.json', true)
const zh = apply('zh.json', false)
console.log(`en.json: removed ${en.removed}, added ${en.added}`)
console.log(`zh.json: removed ${zh.removed}, added ${zh.added}`)
