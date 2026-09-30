# 简化投递设置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 控制台仅保留“筛选不发送 / 自动发送”，固定使用招聘平台已有简历，移除投递设置中的本地简历选择，但保留上传与解析。

**Architecture:** 前端只提交投递模式；后端统一将旧“审核后发送”配置安全迁移到“筛选不发送”，并向浏览器脚本固定提供平台简历方式。简历 ID 仍用于本地词库与 Agent 分析。

**Tech Stack:** FastAPI、原生 JavaScript、Python unittest、Node test。

## Global Constraints

- 在当前功能分支改动；不合并到 main。
- 自动模式仍遵守测试/正式开关；Boss 的平台简历发送时机保持现状。
- 旧审核配置不能因升级自动触发发送。

---

### Task 1: 后端配置和执行计划

**Files:** `product_store.py`、`main.py`、`local_strategy_service.py`、`test_single_route_backend.py`

**Interfaces:** 旧模式 `review` 在读取和保存时归一成 `screen_only`；客户端 `resumeDelivery` 恒为 `platform_resume`。

- [x] 写旧配置迁移、忽略旧简历发送选项、自动模式执行计划的回归测试。
- [x] 运行定向测试并确认因旧行为失败。
- [x] 修改默认值、归一化、客户端配置与执行计划。
- [x] 重跑定向测试。

### Task 2: 控制台表单与 Agent 编辑器

**Files:** `static/index.html`、`static/app.js`、`test_agent_ui.cjs`

**Interfaces:** 两个表单都只提交 `deliveryMode`；本地简历只在上传和词库解析区选择。

- [x] 写表单提交回归测试，并确认旧代码失败。
- [x] 删除两个简历发送方式选项和冗余本地简历下拉框，更新状态显示和表单逻辑。
- [x] 重跑前端测试。

### Task 3: 文档及验证

**Files:** `docs/ARCHITECTURE.md` 与项目已有使用说明。

- [x] 更新现存的三模式或简历发送选项说明。
- [x] 运行 Python/Node 测试、语法检查，并检查 Git diff 与状态。
- [x] 将通过验证的改动提交在当前功能分支。
