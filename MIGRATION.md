# 从老版 NewAPI 迁移到 LLMShare

LLMShare 是 NewAPI（QuantumNous/new-api）的 fork，**数据库 schema 完全兼容**（只是新增了 4 张动态额度相关的表，不影响老表）。所以迁移很简单，有三种方式，按推荐顺序：

## 方式 1：直接复用原数据库（最省事，推荐）

老 NewAPI 和 LLMShare 用的是同一套 MySQL schema。只要让 LLMShare 连到老库即可：

1. 停掉老 NewAPI（避免双写）。
2. 改 LLMShare 的 `SQL_DSN` 指向**同一个** MySQL 数据库：
   ```bash
   SQL_DSN=root:密码@tcp(老库地址:3306)/new-api
   ```
3. 启动 LLMShare。首次启动会自动：
   - 给所有现有用户 seed 动态额度行（保底额度）
   - 自动建好新增的 4 张表（`dynamic_quotas`、`user_spend_buckets`、`channel_budgets`、`waitlist_entries`），GORM AutoMigrate 不会动老表
4. 用户、渠道、Token、日志全部原样保留。

> ⚠️ 建议先备份老库再切：`mysqldump -u root -p new-api > backup.sql`

## 方式 2：导出老库 → 导入新库（换库迁移）

适合换服务器或换数据库实例：

```bash
# 1. 在老库导出
mysqldump -u root -p 老库地址 new-api > newapi-dump.sql

# 2. 在新库导入（先建空库）
mysql -u root -p -e "CREATE DATABASE \`new-api\` DEFAULT CHARACTER SET utf8mb4;"
mysql -u root -p new-api < newapi-dump.sql

# 3. 让 LLMShare 指向新库启动，会自动补建新表 + seed 用户
```

## 方式 3：只迁移配置（设置导出/导入）

如果你只想把老 NewAPI 的**系统设置**搬过来（用户/渠道/Token 不要），用内置的导出/导入：

1. 在老 NewAPI（≥ 同版本）的管理后台 → 系统设置 → 系统维护 → 「设置备份」→ 点 **导出设置**，得到一个 JSON。
2. 在 LLMShare 的同样位置 → 点 **导入设置**，上传该 JSON。
3. 只有配置项会被应用（渠道、模型、密钥等敏感配置需单独在 LLMShare 重新填，因为这些不该跨实例导出）。

## 迁移后检查清单

- [ ] 渠道列表完整、能正常转发请求（渠道的 key 是加密存的，连同一个库可解密；换库需重填）
- [ ] 用户能登录（密码是 bcrypt，跨库仍有效）
- [ ] 动态额度：去 系统设置 → 运营设置 → 动态额度，开个预设（默认已开）
- [ ] 首页：访问根路径看到首页，模型列表自动从渠道读取
- [ ] 系统状态：管理后台侧边栏 → 系统状态，看号池、活跃用户、预计额度
