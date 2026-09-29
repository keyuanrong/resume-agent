# 简历证据优先词表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让手动和 Agent 模式共用本地简历词表，Agent 只复核边界岗位。

**Architecture:** 扩展现有 `local_strategy_service.generate_local_strategy` 处理用户确认的岗位、技能和模型版本。Agent 两个策略路由改用这一生成器；图片先转录文字。现有 `/get-job-score` 保留边界岗位 Agent 复核。

**Tech Stack:** Python 3、FastAPI、unittest、原有静态 JS。

## Global Constraints

- 仅在 `feature/my-change` 修改；不更改用户本地 API Key。
- 只有用户明确填写的排除词可硬拦截。
- 不把强化学习自动当作独立 VLA 求职方向。

---

### Task 1: 本地词表准确性

**Files:** `local_strategy_service.py`, `core.py`, `test_evidence_strategy.py`

**Interfaces:** `generate_local_strategy(text, target_roles=None, preferred_skills=None, ...) -> dict`；`evaluateJobMatch(job, scoring) -> dict`。

- [x] 写失败测试：π0.5 与 π0 分别保留；纯 RL 标题不加分；VLA+RL 标题加分；不生成 Sim2Real。
- [x] 运行 `./.venv/bin/python -m unittest test_evidence_strategy -v`，确认按预期失败。
- [x] 修改本地词表与版本匹配，只做满足测试的改动。
- [x] 重跑该测试，确认通过。

### Task 2: Agent 模式复用本地词表

**Files:** `main.py`, `agent_service.py`, `test_evidence_strategy.py`

**Interfaces:** `api_agent_analyze_resume(payload)` 和 `api_agent_build_strategy(payload)` 返回现有前端格式；`QwenAgent.extract_resume_text(resume)` 仅供图片转录。

- [x] 写失败测试：文字简历分析和最终策略不调用 Agent；用户目标岗位覆盖模板搜索词；图片转录后进入本地生成器。
- [x] 运行 `./.venv/bin/python -m unittest test_evidence_strategy -v`，确认按预期失败。
- [x] 修改两条路由；图片增加转录方法；复用本地生成器。
- [x] 重跑测试，确认通过。

### Task 3: 文案和回归验证

**Files:** `static/index.html`, `static/app.js`, `readme.md`

- [x] 更新简历分析和图片上传提示，使页面准确说明哪些情况会调用模型。
- [x] 运行 `./.venv/bin/python -m unittest test_evidence_strategy test_agent_weighted_scoring test_agent_strategy_questions test_agent_configuration test_agent_keyring test_agent_routing test_agent_models_route -q`。
- [x] 运行 Node UI 测试、语法检查和 `git diff --check`，确认输出。
- [x] 提交到 `feature/my-change`，不推送、不合并。
