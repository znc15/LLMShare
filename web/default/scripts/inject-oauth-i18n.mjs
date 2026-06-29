import fs from 'node:fs'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

const NEW_KEYS = {
  'Require Email for Quick Login': '快捷登录必须绑定邮箱',
  'OAuth/quick-login users (GitHub, WeChat, Telegram, Passkey, etc.) must bind a verified email before they can log in. Password login is unaffected.':
    '通过 GitHub / 微信 / Telegram / Passkey 等快捷方式登录的用户，必须先绑定一个已验证的邮箱才能登录。账号密码登录不受影响。',
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
