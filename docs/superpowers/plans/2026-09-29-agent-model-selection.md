# Agent 模型选择与密钥保护实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 设置收敛为模型和 API Key 两项，并支持百炼、DeepSeek 模型列表与系统密钥库。

**Architecture:** `model_providers.py` 固定两家服务商的端点和模型列表解析；`product_store.py` 用系统密钥库保存服务商各自的 Key；`agent_service.py` 按服务商组装推理请求；`main.py` 提供模型列表接口；`static` 两个文件更新界面。用户先在模型控件选服务商所属的型号，后端只查该服务商。

**Tech Stack:** Python 3.10+、FastAPI、标准库 `urllib`、Python `keyring`、原生 HTML/JS、`unittest`。

## Global Constraints

- 只修改 `feature/my-change`，不创建另一分支。
- 首批仅支持百炼北京地域和 DeepSeek；不向未知主机发 Key。
- 页面只有“模型”和“API Key”两个输入项；Key 不回显、不记录日志、不落盘明文。
- 密钥库不可用时明确报错，不回退明文；旧 `data/secrets.json` 仅在成功迁移后删除。
- 不调用真实模型作为自动测试；人工联调用用户本机自己的 Key。

---

### Task 1: 服务商注册表与模型列表

**Files:**
- Create: `model_providers.py`
- Create: `test_agent_configuration.py`

**Interfaces:**
- `get_provider(provider_id: str) -> Provider`：只返回 `bailian` 或 `deepseek` 的固定端点。
- `list_provider_models(provider_id: str, api_key: str) -> list[dict]`：返回 `id/name/provider`，不返回 Key。

- [ ] **Step 1: 写失败测试。** 在 `test_agent_configuration.py` 用 `unittest` 和模拟的 `urllib.request.urlopen` 响应，分别验证百炼的 `output.models[]` 和 DeepSeek 的 `data[]` 解析为统一结构；未知服务商抛错；请求仅指向选中服务商。
- [ ] **Step 2: 运行 `PYTHONDONTWRITEBYTECODE=1 python -m unittest -v test_agent_configuration.py`，确认因模块/接口不存在而失败。**
- [ ] **Step 3: 实现固定注册表与两个列表解析函数。** 百炼列表先用 `https://dashscope.aliyuncs.com/api/v1/models`；若服务端不支持，明确提示无法自动列出且保留内置候选，不猜测可用型号。DeepSeek 用 `https://api.deepseek.com/models`。请求超时、401 和异常响应转成无 Key 的错误文本。
- [ ] **Step 4: 重跑测试，确认通过；提交本任务。**

### Task 2: 系统密钥库与旧 Key 迁移

**Files:**
- Modify: `product_store.py`
- Modify: `main.py`（新增 `/api/agent/models`）
- Modify: `requirements.txt`（加入 `keyring==25.7.0`）
- Modify: `test_agent_configuration.py`

**Interfaces:**
- `get_api_key(provider: str = 'bailian') -> str`；`set_api_key(value: str, provider: str = 'bailian') -> None`。
- `get_product_config(public=True)` 只暴露当前服务商的 `hasApiKey` 布尔值。

- [ ] **Step 1: 写失败测试。** 用替身密钥库验证不同服务商 Key 隔离、公开配置不含 Key、密钥库写入失败不写明文、旧 Key 成功写入后删除文件、迁移失败保留旧文件。
- [ ] **Step 2: 运行上述测试，确认各测试因现有文件存储行为而失败。**
- [ ] **Step 3: 实现密钥库存取、一次性迁移和只返回非敏感字段的 FastAPI 模型列表路由。** 使用服务名 `resume-agent`、账户名 `bailian/deepseek`；检查无可用后端时抛可读错误；先完成写入并校验，再删除旧文件；不在响应或日志中包含 Key。
- [ ] **Step 4: 重跑测试，确认通过；提交本任务。**

### Task 3: 推理调用按服务商路由

**Files:**
- Modify: `agent_service.py`
- Modify: `test_agent_configuration.py`

**Interfaces:**
- 当前配置中的 `agent.provider` 和 `agent.model` 决定服务商端点；`QwenAgent` 可改名为通用 `ModelAgent`，保留 `get_agent()` 调用方接口。

- [ ] **Step 1: 写失败测试。** 构造两家配置与替身 HTTP 响应，断言 URL、Bearer Key、模型 ID 只匹配同一家；DeepSeek 请求不携带百炼专属 `enable_thinking`；模型返回合法 JSON 时可解析。
- [ ] **Step 2: 运行测试确认预期失败。**
- [ ] **Step 3: 用注册表替代从配置接受任意 `baseUrl`；按服务商选择请求字段，沿用 JSON 结果解析和三类 Agent 任务。**
- [ ] **Step 4: 重跑测试，确认通过；提交本任务。**

### Task 4: 两字段界面与完整验证

**Files:**
- Modify: `static/index.html`
- Modify: `static/app.js`
- Modify: `readme.md`
- Modify: `test_agent_configuration.py`

**Interfaces:**
- 模型控件记录选中的 `{provider, model}`，保存时仅提交这两项和可选新 Key；“获取可用模型”调用 `/api/agent/models?provider=...`，失败不清空当前选择。

- [ ] **Step 1: 写失败测试。** 验证页面不再包含单独的服务商输入项，只有模型与密码输入；控制台脚本保存后清空 Key，接口响应不回显 Key，模型列表失败保留选择。
- [ ] **Step 2: 运行测试确认预期失败。**
- [ ] **Step 3: 实现界面和文档。** 模型候选按服务商分组；已有 Key 显示状态不回填；用户明确选服务商所属型号后才请求该服务商列表；错误消息显示在界面上。
- [ ] **Step 4: 在隔离副本运行 `python -m unittest -v test_agent_configuration.py test_single_route_backend.py` 和 Python 语法检查；确认当前分支 diff 只含目标文件，再提交。**

## 自检

- 规格中的两个输入项、两家服务商、模型列表、Key 隔离、迁移及错误行为均有对应任务。
- 真实 API 连通性与系统密钥库解锁状态无法通过无凭据自动测试证明，最终报告中需明确列出本机联调步骤与限制。
