import fs from 'node:fs'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

const NEW_KEYS = {
  // dynamic quota settings — channel cap + period + max topup
  'Channel Budget Cap (USD)': '渠道预算上限（美元）',
  'Max spend per channel over the selected period (0 = no cap)':
    '单个渠道在所选周期内的最大花费（0 = 不限）',
  'Cap Period': '上限周期',
  'Window over which the channel cap is counted': '渠道上限的计算周期',
  'Daily': '每日',
  'Hourly': '每小时',
  'Max Top-Up (USD)': '单次充值上限（美元）',
  'Maximum amount a user may recharge in a single top-up (0 = unlimited)':
    '用户单次充值的最大金额（0 = 不限）',
  // login page image
  'Login Page Image URL': '登录页图片 URL',
  'Image shown on the left half of the login/register page (optional). Leave empty for the default gradient.':
    '显示在登录/注册页左半边的图片（可选）。留空则使用默认渐变背景。',
  // wallet recharge max hint
  'Single top-up maximum: {{n}}': '单次充值上限：{{n}}',
  'Exceeds the single top-up maximum of {{n}}': '超过单次充值上限 {{n}}',
  // system status — period labels
  'Channel Cap': '渠道上限',
  'hr': '时',
  'day': '天',
  'Usage': '用量',
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
