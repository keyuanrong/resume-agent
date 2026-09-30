# 按搜索词控制查看数量实施计划

> **For agentic workers:** 使用单会话逐项实施；每项按测试先行、失败确认、最小实现、回归验证执行。

**Goal:** 每个搜索词独立限制查看数，移除无效或重复的平台设置。

**Architecture:** 策略保存 `jobsPerKeyword`，后端映射到浏览器配置 `maxJobsPerKeyword`。BOSS 和其他平台执行器各自维护搜索词计数。控制台只提供真正生效的设置。

**Tech Stack:** FastAPI、原生 JavaScript、Python unittest、Node test runner。

## 全局约束

- 默认每词 20 个岗位，范围 1–1000。
- 去重岗位不计入查看额度；一次启动内跨翻页累计。
- BOSS 使用平台招呼语，智联无平台预填内容时转人工。

---

### 任务 1：配置与表单

**文件：** `main.py`、`product_store.py`、`static/index.html`、`static/app.js`、相关测试。

- [ ] 先添加后端和前端行为测试并确认失败。
- [ ] 将策略字段改为 `jobsPerKeyword`，映射 `maxJobsPerKeyword`，移除旧字段与输入。
- [ ] 运行对应测试并确认通过。

### 任务 2：BOSS 限额

**文件：** `web_script.js`、浏览器脚本测试。

- [ ] 先添加每词独立计数与切换测试并确认失败。
- [ ] 在抓取和换词流程按当前搜索词剩余额度控制，全部完成后暂停。
- [ ] 运行对应测试并确认通过。

### 任务 3：其他平台与平台招呼语

**文件：** `multi_platform_test.user.js`、`local_strategy_service.py`、`agent_service.py`、相关测试与 `readme.md`。

- [ ] 先添加每词额度与无平台预填消息的测试并确认失败。
- [ ] 移除自写招呼语；其他平台逐词计数，更新说明文档。
- [ ] 运行全部相关测试与语法检查，复核差异。
