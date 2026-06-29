import fs from 'node:fs'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

const NEW_KEYS = {
  'Quick Presets': '快速预设',
  'Select a preset…': '选择一个预设…',
  'Applies amounts and enables Dynamic Quota — review then Save.':
    '填入各项额度并开启动态额度 —— 请核对后点保存。',
  'Preset applied — click Save to confirm': '预设已应用 —— 请点击保存确认',
  'Personal / Small Team': '个人 / 小团队',
  'Small pool (~10 users). Tight budgets, quota clearly scales with demand.':
    '小预算池（约 10 用户）。额度紧张，能明显看出按需求量分配的差异。',
  'Standard Sharing': '标准共享',
  'Balanced default (~30 users). Recommended for most shared gateways.':
    '均衡默认值（约 30 用户）。推荐大多数共享网关使用。',
  'Generous / Public': '宽松 / 公开',
  'Large pool (~50 users). Loose limits, prioritizes availability.':
    '大预算池（约 50 用户）。限制宽松，优先保证可用性。',
  'Tight / Cost-Controlled': '紧凑 / 成本控制',
  'Minimal spend, everyone capped low. Good for expensive models.':
    '花费最少，所有人都卡低上限。适合昂贵模型。',
  'Pool ${{b}}/h · Floor ${{f}} · Cap ${{c}}':
    '预算池 ${{b}}/h · 保底 ${{f}} · 上限 ${{c}}',
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
