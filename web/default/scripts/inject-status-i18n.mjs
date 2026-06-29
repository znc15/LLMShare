import fs from 'node:fs'
import path from 'node:path'

const LOCALES_DIR = path.resolve('src/i18n/locales')

const NEW_KEYS = {
  // system status page
  'System Status': '系统状态',
  'Dynamic quota is active — quota is reallocated hourly by demand.':
    '动态额度已启用 —— 额度按使用量每小时重新分配。',
  'Dynamic quota is disabled — users use a static balance.':
    '动态额度未启用 —— 用户使用固定余额。',
  'Active': '运行中',
  'Disabled': '已停用',
  'Expected Quota per User': '预计每人可拿额度',
  'hour': '小时',
  'Even-split baseline: pool ÷ active users. Actual per-user quota varies by 24h demand (heavy users get more, capped at the per-user cap).':
    '均分基准：预算池 ÷ 活跃用户数。实际每人额度按 24 小时使用量浮动（用得多的拿得多，受个人上限封顶）。',
  'Active Users': '活跃用户',
  'of': '共',
  'cap': '上限',
  'Slots Remaining': '剩余名额',
  'Open for registration': '可开放注册',
  'Waitlist active': '候补启用中',
  'Waitlist Size': '候补人数',
  'Waiting in queue': '队列等待中',
  'At Cap': '已达上限',
  'users maxed out': '用户用满额度',
  'Allocation Config': '分配配置',
  'Hourly Pool': '每小时预算池',
  'Per-User Floor': '每人保底',
  'Per-User Cap': '每人上限',
  'Lookback': '回溯时长',
  'Inactivity Eviction': '不活跃清理',
  'Channel Daily Cap': '渠道每日上限',
  'Last Reallocation': '上次重新分配',
  'Last Run': '上次运行',
  'Next Run': '下次运行',
  'Evictions': '清理人数',
  'Promotions': '提升人数',
  'No tick has run yet. The first run happens at the next hour boundary.':
    '尚未运行过。首次分配将在下一个整点进行。',
  'Channel Pool': '号池状态',
  'Today': '今日',
  'This Hour': '本小时',
  'Requests': '请求数',
  'Daily Usage': '今日用量',
  'No channels configured.': '尚未配置任何渠道。',
  'Loading…': '加载中…',
  'No data': '暂无数据',
  // dynamic quota card (user)
  'Refreshed hourly by your usage': '按您的使用量每小时刷新',
  'Remaining this hour': '本小时剩余',
  'Hourly Quota': '小时额度',
  'Used': '已用',
  '24h Demand': '24 小时需求',
  'Demand Weight': '需求权重',
  'Eviction in': '距清理还有',
  'Your quota is recomputed every hour based on your recent usage. Use more to get more (up to the cap); stay idle and it drops to the floor. No requests for {{n}} days removes your account.':
    '您的额度每小时按近期使用量重新计算。用得多额度就涨（受个人上限封顶），闲置则降至保底。{{n}} 天无请求将移除账号。',
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
