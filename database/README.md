# 数据库

这个目录保存 Atrium 的数据库结构契约。

- `schema.sql`：核心业务表的 MySQL 初始化结构。
- 压测种子数据和清理工具放在 `scripts/` 下，因为它们是操作脚本，不是 schema 定义。

```bash
mysql -u root -p < database/schema.sql
```
