import fs from 'node:fs'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

// New LLMShare i18n keys: { english_key: chinese_translation }
// Keys that are NOT user-facing strings (URLs like '/api/...') are excluded.
const NEW_KEYS = {
  // ---- waitlist page ----
  'Join the waitlist': '加入候补名单',
  'Registration is currently full. Enter your email to join the waitlist — you will get a magic link when a slot opens.': '注册名额已满。请输入邮箱加入候补名单 —— 名额释放时您会收到一封包含激活链接的邮件。',
  'Your position': '您的排队位置',
  'Email': '邮箱',
  'Join waitlist': '加入候补名单',
  'Check my position': '查询我的排队位置',
  'Already have an account?': '已有账号？',
  'Sign in': '登录',
  'You have joined the waitlist': '您已加入候补名单',
  'Failed to join waitlist': '加入候补名单失败',
  'Please enter your email': '请输入邮箱',
  'Not found': '未找到',
  'Position #{{n}}': '排队位置 #{{n}}',
  // ---- activate page ----
  'Activate your account': '激活您的账号',
  'Your waitlist slot is ready. Choose a username and password to finish activating your account.': '您的候补名额已就绪。请设置用户名和密码以完成账号激活。',
  'Account activated successfully!': '账号激活成功！',
  'Account activated! Please sign in': '账号已激活，请登录',
  'Activate account': '激活账号',
  'Activation failed': '激活失败',
  'Invalid or expired activation link': '激活链接无效或已过期',
  'Back to waitlist': '返回候补名单',
  'Enter your username': '请输入用户名',
  'Enter password (8-20 characters)': '请输入密码（8-20 位）',
  'Username': '用户名',
  'Password': '密码',
  // ---- dynamic quota settings ----
  'Dynamic Quota': '动态额度',
  'Enable Dynamic Quota': '启用动态额度',
  'When enabled, each user gets an hourly quota recomputed from their 24h demand, instead of a static balance.': '启用后，每位用户每小时获得的额度将根据其过去 24 小时的使用量动态计算，而非固定的静态余额。',
  'Hourly Budget Pool (cents)': '每小时预算池（美分）',
  'Total USD-cents split across all users each hour (B)': '每小时在所有用户之间分配的总额度（美分，对应公式中的 B）',
  'Per-User Floor (cents)': '每位用户保底额度（美分）',
  'Guaranteed minimum per user per hour (F)': '每位用户每小时保底获得的额度（对应公式中的 F）',
  'Per-User Cap (cents)': '每位用户上限（美分）',
  'Maximum any user can get per hour (C)': '每位用户每小时最多可获得的额度（对应公式中的 C）',
  'Demand Lookback (hours)': '需求回溯时长（小时）',
  'Window used to measure each user demand weight': '用于衡量每位用户使用权重的统计时间窗口',
  'Inactivity Eviction (days)': '不活跃清理天数',
  'Hard-delete users inactive this long': '超过该天数未发起请求的用户将被硬删除',
  'Total User Cap': '用户总数上限',
  'Max active users; beyond this, join the waitlist': '活跃用户上限；超出后新用户需加入候补名单',
  'Magic Link TTL (hours)': '激活链接有效期（小时）',
  'How long a promotion link stays valid': '提升邀请的激活链接有效时长',
  'Channel Daily Cap (cents)': '渠道每日上限（美分）',
  'Per-channel USD-cents spend limit per day': '单个渠道每天的消费上限（美分）',
  'Channel Hourly Cap (cents)': '渠道每小时上限（美分）',
  'Per-channel USD-cents spend limit per hour (0 = off)': '单个渠道每小时的消费上限（美分，0 表示关闭）',
  'Run reallocation now': '立即重新分配',
  'Triggers an immediate evict → promote → reallocate cycle': '立即触发一次「清理不活跃 → 提升候补 → 重新分配额度」的完整周期',
  'Reallocation tick scheduled': '重新分配任务已调度',
  'Failed to run tick': '触发重新分配失败',
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

function inject(localeFile, keyValuePairs, isEn) {
  const full = path.join(LOCALES_DIR, localeFile)
  const json = readJson(full)
  const trans = json.translation || (json.translation = {})
  let added = 0
  for (const [key, zhVal] of Object.entries(keyValuePairs)) {
    if (trans[key] === undefined) {
      // en: value = key; other locales: value = translation
      trans[key] = isEn ? key : zhVal
      added++
    }
  }
  writeJson(full, json)
  return added
}

const enAdded = inject('en.json', NEW_KEYS, true)
const zhAdded = inject('zh.json', NEW_KEYS, false)

console.log(`en.json: +${enAdded} keys`)
console.log(`zh.json: +${zhAdded} keys`)
