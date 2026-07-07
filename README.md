<div align="center">

![llmshare](/web/default/public/logo.png)

# LLMShare

🎟️ **NewAPI 二开分支 —— 面向共享 / 公益场景的邀请码注册网关**

在 NewAPI（LLM 中转网关）基础上，移除了原先的动态额度 / 候补名单 / 用户池上限 / 渠道预算等限制层，改为更简单直接的**邀请码注册**门槛：管理员一次性发码，凭码注册。

> Fork 自 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)（即 Calcium-Ion/new-api），数据库 schema 完全兼容，可平滑迁移。详见 [迁移指南](./MIGRATION.md)。

</div>

---

## ✨ 与原版 NewAPI 的区别

LLMShare 面向「需要控制注册准入、但不想被复杂额度分配绑架」的场景，核心改动：

| 能力 | 说明 |
|------|------|
| **邀请码注册（核心）** | 注册门槛由一次性邀请码控制。管理员在后台批量生成（可设过期天数、备注），用户凭码注册（密码 + OAuth 通用）。码用一次即作废，事务内消费保证「注册成功 ⇔ 码已消费」原子一致。 |
| **充值上限** | 全局「单次充值上限」设置，后端拦截 + 钱包页显示并禁用超限按钮。 |
| **快捷登录需绑邮箱** | OAuth（GitHub/微信/Telegram/Passkey 等）用户必须绑定已验证邮箱才能登录；密码登录不受影响。 |
| **首页自定义** | 默认首页为内置的 LittleSheep 落地页（同域 iframe），模型列表实时从渠道读取，支持深色模式跟随 NewAPI 主题。可在「站点设置」改图片 URL / HomePageContent。 |
| **设置备份** | 一键导出 / 导入全部系统配置（JSON），便于备份与跨实例迁移。 |

### 已移除的（相对早期 LLMShare 版本）

为回归 NewAPI 原生的额度/计费行为，以下 fork 特性已删除：

- ❌ 动态额度（每小时按需求重分配钱包余额）
- ❌ 候补名单 + magic-link 激活
- ❌ 用户总数上限（TotalUserCap）
- ❌ 渠道预算上限 + failover（ChannelBudget）
- ❌ 不活跃用户自动清理
- ❌ 系统状态页（动态额度专属）

注册准入改由**邀请码**单一机制承担。用户额度、渠道选择、计费等回归 NewAPI 原生逻辑。

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
| 启用邀请码注册 | 开 | 系统设置 → 运营设置 → 注册 |
| 单次充值上限 | $0（不限） | 系统设置 → 运营设置 → 注册 |
| 快捷登录需绑邮箱 | 开 | 系统设置 → 运营设置 → 注册 |
| 登录页图片 URL | 空（默认渐变） | 系统设置 → 站点 → 系统信息 |
| 首页内容 | /home.html | 系统设置 → 内容（HomePageContent） |

邀请码在「系统设置 → 运营设置 → 注册」面板内联管理：输入数量 / 备注 / 过期天数即可批量生成，支持一键复制、删除。

## 🎫 邀请码使用流程

1. 管理员在「运营设置 → 注册」面板生成邀请码（可批量、可设过期天数）。
2. 把码发给受邀用户。
3. 用户在注册页填邀请码 → 密码注册或 OAuth 注册都需校验该码。
4. 注册成功的事务内同步消费该码（用一次即作废，并发安全）。

OAuth 流程：用户在注册页先填邀请码，再点 OAuth 按钮；邀请码随 OAuth state 暂存到服务端 session，回调时自动校验消费。

## 🗂 项目结构（相对上游新增）

```
model/
  invitation_code.go      # 一次性邀请码表（生成/查找/消费/列表/删除）
service/
  registration_email.go   # 注册成功欢迎邮件
controller/
  invitation_code.go      # 邀请码管理 API（admin）
  option_export.go        # 设置导出/导入
web/default/
  public/home.html        # 默认首页（深色模式 + postMessage 主题同步）
  src/features/
    home/                 # 落地页
    system-settings/operations/registration-section.tsx
                          # 注册设置 + 邀请码内联管理面板
```

## 📚 文档

- [迁移指南](./MIGRATION.md) —— 从老版 NewAPI 迁移到 LLMShare
- 上游 NewAPI 文档见各语言 README

## 🧮 从旧版 LLMShare（≤0.1.x）升级

旧版的 4 张表（`dynamic_quotas`、`user_spend_buckets`、`channel_budgets`、`waitlist_entries`）已不再使用，可手动 DROP：

```sql
DROP TABLE IF EXISTS dynamic_quotas;
DROP TABLE IF EXISTS user_spend_buckets;
DROP TABLE IF EXISTS channel_budgets;
DROP TABLE IF EXISTS waitlist_entries;
```

升级后需在「运营设置 → 注册」生成邀请码并（默认已开）启用邀请码注册开关，否则新用户无法注册。

## 📄 License

继承上游 [AGPL-3.0](./LICENSE)。
