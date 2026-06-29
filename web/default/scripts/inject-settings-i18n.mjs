import fs from 'node:fs'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

const NEW_KEYS = {
  // presets
  'Free Trial': '免费试用',
  'Tiny pool for evaluation. Heavy throttle so a few users can try it.':
    '极小预算池，用于评估体验。重度限流，让少数用户试用。',
  'Team / Pro': '团队 / 专业',
  'Medium pool for a paying team (~20 users). Moderate limits, fair split.':
    '中型预算池，适合付费团队（约 20 人）。额度适中，分配公平。',
  'Heavy / Power Users': '重度 / 高频用户',
  'Higher caps for intensive users (~10). Lets power users push the cap.':
    '为高频用户设高上限（约 10 人）。让重度用户能跑满上限。',
  // settings export/import
  'Settings Backup': '设置备份',
  'Export all configuration options as a JSON file for backup or migration.':
    '将所有配置项导出为 JSON 文件，用于备份或迁移。',
  'Export Settings': '导出设置',
  'Import Settings': '导入设置',
  'Imported: {{applied}} applied, {{skipped}} skipped':
    '导入完成：应用 {{applied}} 项，跳过 {{skipped}} 项',
  'Import failed': '导入失败',
}

function readJson(f) {
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}
function writeJson(f, obj) {
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

function inject(file, isEn) {
  const full = path.join(LOCALES_DIR, file)
  const json = readJson(full)
  const trans = json.translation || (json.translation = {})
  let added = 0
  for (const [key, zh] of Object.entries(NEW_KEYS)) {
    if (trans[key] === undefined) {
      trans[key] = isEn ? key : zh
      added++
    }
  }
  writeJson(full, json)
  return added
}

console.log(`en.json: +${inject('en.json', true)} keys`)
console.log(`zh.json: +${inject('zh.json', false)} keys`)
