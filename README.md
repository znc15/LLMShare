<div align="center">

![llmshare](/web/default/public/logo.png)

# LLMShare

🧑‍🤝‍🧑 **NewAPI 二开分支 —— 面向共享 / 公益场景的动态额度网关**

在 NewAPI（LLM 中转网关）基础上，加入**动态额度分配**、**候补名单**、**不活跃清理**、**渠道预算管控**等共享场景必需的能力。

> Fork 自 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)（即 Calcium-Ion/new-api），数据库 schema 完全兼容，可平滑迁移。详见 [迁移指南](./MIGRATION.md)。

</div>

---

## ✨ 与原版 NewAPI 的区别

LLMShare 面向「一个号池多人共享、动态分配额度」的场景，核心新增：

| 能力 | 说明 |
|------|------|
| **动态额度（核心）** | 每小时按用户过去 24h 的实际使用量，把预算池按比例重新分配给每个用户。用得多 → 额度涨；用得少 → 降到保底。**动态额度即钱包余额**：每小时 tick 时把分配额度直接充值进用户钱包，API 调用正常扣费，余额为 0 自动返回 429。 |
| **预设配置** | 7 套开箱即用的预设（个人 / 标准 / 宽松 / 紧凑 / 免费试用 / 团队 / 重度），一键填入并开启动态额度。 |
| **候补名单** | 用户总数达上限后注册关闭，新用户加入 FIFO 候补队列。名额释放时自动提升并发送 magic-link 激活邮件（24h 有效）。 |
| **不活跃清理** | 超过 N 天（默认 7 天）没发起请求的用户被硬删除，名额释放给候补者。管理员账号永不清理。 |
| **渠道预算管控** | 每个渠道可设「额度上限 + 周期（每日/每小时）」，超限自动轮转到下一个渠道（failover），只在所有渠道都耗尽时才向用户返回 429。 |
| **系统状态页** | 管理后台侧边栏「系统状态」：预计每人可拿额度、活跃用户数、剩余名额、候补人数、号池各渠道花费与用量进度条。 |
| **充值上限** | 全局「单次充值上限」设置，后端拦截 + 钱包页显示并禁用超限按钮。 |
| **快捷登录需绑邮箱** | OAuth（GitHub/微信/Telegram/Passkey 等）用户必须绑定已验证邮箱才能登录；密码登录不受影响。 |
| **首页自定义** | 默认首页为内置的 LittleSheep 落地页（同域 iframe），模型列表实时从渠道读取，支持深色模式跟随 NewAPI 主题。可在「站点设置」改图片 URL / HomePageContent。 |
| **设置备份** | 一键导出 / 导入全部系统配置（JSON），便于备份与跨实例迁移。 |

### 动态额度分配公式

每个整点（`:00`）跑一次 tick：

```
B = 每小时预算池      F = 每人保底额度      C = 每人上限
n = 活跃用户数        sᵢ = 用户 i 过去 24h 花费   S = Σ sᵢ

qᵢ = F + (B − n·F) · sᵢ / S     # 保底 + 按需求比例瓜分余量
qᵢ = min(qᵢ, C)                  # 卡上限
分不完的余量留作 slack（不强求花完）

每个用户的钱包余额被重置为 qᵢ（动态额度即钱包）
```

## 🚀 快速开始

### Docker（推荐）

```bash
# 用项目自带的测试 compose（含 MySQL + Redis）
docker compose -f docker-compose.test.yml up -d --build
```

访问 http://localhost:3000 完成初始化。

> ⚠️ `up --build` **不会删数据库**（MySQL 数据卷持久化）。需要清空数据库时才用 `down -v`。

### 本地开发

```bash
# 前端
cd web/default
bun install
bun run dev

# 后端
go run main.go
```

## ⚙️ 关键配置

| 配置项 | 默认值 | 位置 |
|--------|--------|------|
| 启用动态额度 | 开 | 系统设置 → 运营设置 → 动态额度 |
| 每小时预算池 B | $50 | 同上（金额按美元填写，存为整数美分） |
| 每人保底 F | $0.50 | 同上 |
| 每人上限 C | $5 | 同上 |
| 需求回溯时长 | 24 小时 | 同上 |
| 不活跃清理天数 | 7 天 | 同上 |
| 用户总数上限 | 50 | 同上 |
| 渠道预算上限 + 周期 | $100 / 每日 | 同上 |
| 单次充值上限 | $0（不限） | 同上 |
| 快捷登录需绑邮箱 | 开 | 同上 |
| 登录页图片 URL | 空（默认渐变） | 系统设置 → 站点 → 系统信息 |
| 首页内容 | /home.html | 系统设置 → 内容（HomePageContent） |

所有金额类设置在表单里按**美元**填写，内部自动换算为整数美分存储（避免浮点精度）。

## 🗂 项目结构（相对上游新增）

```
model/
  dynamic_quota.go        # 每用户动态额度 + 钱包联动
  user_spend_bucket.go    # 每小时消费桶（24h 需求统计）
  channel_budget.go       # 渠道预算窗口（每日/每小时）
  waitlist.go             # 候补 FIFO + magic-token 状态机
service/
  dynamic_quota_scheduler.go   # 每小时 tick：清理→提升→重分配→充钱包
  dynamic_quota_enforce.go     # 消费结算 + 美分/额度换算
  channel_budget.go            # 渠道预算检查 + failover 缓存
  dynamic_quota_email.go       # 候补确认/提升/清理 三种邮件
controller/
  waitlist.go             # 候补/激活/系统状态/号池 等接口
  option_export.go        # 设置导出/导入
middleware/
  dynamic-quota.go        # （保留）动态额度中间件
web/default/
  public/home.html        # 默认首页（深色模式 + postMessage 主题同步）
  src/features/
    system-status/        # 管理端系统状态页
    auth/{waitlist,activate}/  # 候补/激活页
    wallet/components/dynamic-quota-card.tsx  # 用户钱包动态额度卡
```

## 📚 文档

- [迁移指南](./MIGRATION.md) —— 从老版 NewAPI 迁移到 LLMShare
- 上游 NewAPI 文档见各语言 README

## 🧪 测试验证

全流程已通过端到端测试：注册 → 动态额度自动 seed → 创建 Token → 调用 API → 余额正确扣减 → 钱包为 0 返回 429 → 候补提升 → 不活跃清理。

## 📄 License

继承上游 [AGPL-3.0](./LICENSE)。
