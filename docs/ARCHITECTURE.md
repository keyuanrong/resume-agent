# 平台适配设计

## 目标

Agent 和手动模式只负责生成统一求职策略。招聘平台差异只存在于适配器层，任务调度和评分逻辑不依赖 Boss、智联或前程无忧的具体 DOM。

## 统一数据

岗位至少转换为：

```json
{
  "platform": "boss",
  "externalId": "平台岗位 ID",
  "title": "岗位名称",
  "company": "公司名称",
  "salary": "薪资文本",
  "city": "城市",
  "detail": "完整 JD",
  "url": "岗位链接"
}
```

统一策略至少包含：

```json
{
  "searchKeywords": [],
  "excludedKeywords": [],
  "companyBlockKeywords": [],
  "threshold": 80,
  "jobsPerKeyword": 20,
  "deliveryMode": "review",
  "resumeDelivery": "platform_resume",
  "resumeId": null,
  "scoring": {
    "title_strong_keywords": {},
    "title_medium_keywords": {},
    "detail_infra_keywords": {},
    "detail_support_keywords": {},
    "title_block_keywords": {},
    "title_penalty_keywords": {},
    "detail_negative_keywords": {}
  }
}
```

`scoring` 必须属于当前策略。免费模式先由 `local_strategy_service.py` 从简历列出多个候选职业方向，用户确认目标方向后再按对应模板生成；Agent 模式由 Agent 结果生成或根据其结构化字段编译，纯手动模式由用户输入编译。模板中的相邻方向只能默认扣分，只有用户明确填写的排除词可以硬拦截。评分器只有在没有已确认的新策略时才兼容读取旧 `user_config.json`，不能把某个用户的固定词库套到其他用户身上。

## 浏览器适配器契约

每个平台执行器需要提供这些逻辑动作：

```javascript
class PlatformAdapter {
  isLoggedIn() {}
  searchJobs(strategy) {}
  getJobList() {}
  getJobDetail(job) {}
  sendGreeting(job, message) {}
  sendResume(job, resume, deliveryPreference) {}
  getMessages() {}
}
```

返回值必须区分 `success`、`unsupported`、`requires_reply`、`requires_manual_review` 和 `failed`，不能把找不到入口视为成功。

## 能力协商

后端 `platforms.py` 是能力注册表。调度器应先读取能力，再选择执行路径：

```text
支持首次附件      -> 招呼语 + 附件
不支持首次附件    -> 先发送招呼语
支持聊天附件      -> 建立聊天后发送 PDF/图片
仅支持平台简历    -> 选择平台已有简历
以上均不支持      -> 标记为需要人工处理
```

能力必须由真实页面测试确认，不能根据产品宣传或猜测填写。

## 硬规则顺序

```text
登录状态
  -> 每日上限
  -> 岗位去重
  -> 公司黑名单
  -> 用户排除词
  -> 规则评分
  -> 边界岗位 Agent
  -> 投递模式
  -> 平台能力
  -> 执行动作与日志
```

Agent 不能覆盖公司黑名单、每日上限或用户明确排除条件。

## 公司名称是跨平台硬字段

Boss、智联和前程无忧的适配器都必须从至少两个来源提取公司名称：岗位列表卡片和岗位详情/结构化数据。选择器登记在 `platforms.py` 的 `companyExtraction` 中。

无论用户是否配置公司黑名单，只要 `company` 缺失或等于“公司”“企业信息”等栏目标题，后端都只允许评分和记录，强制 `autoSend=false`。平台适配器不得在公司未知时执行打招呼或发送简历。

## 新平台验收标准

一个平台只有同时满足下面条件，才能在 `platforms.py` 标记为 `implemented: true`：

1. 可以可靠判断登录状态。
2. 可以按关键词搜索并翻页或继续加载。
3. 能提取岗位 ID、名称、公司、薪资和完整 JD。
4. 公司黑名单在任何联系动作之前生效。
5. 只筛选、审核、自动发送三种模式均已验证。
6. 每一种声称支持的简历发送方式都有成功和失败日志。
7. 选择器失效、弹窗、频控和登录过期时会安全停止，不会误点。
8. 使用测试账号完成小批量人工复核。

## 当前实现状态

- Boss：现有 Tampermonkey 执行链已接入，支持规则评分、公司名、招呼和平台已有简历。
- 智联：搜索、列表、详情、公司/JD 提取和自动沟通已用真实页面校准；审核模式逐岗确认，自动模式连续处理并在异常时停止。智联网页端未暴露已验证的回复列表和简历工具栏，不声称支持未验证的回复后附件发送。
- 前程无忧：能力登记、配置入口和不发送的全链路测试适配器已完成；真实页面选择器待首轮运行校准，发送能力未开放。

后续把 Boss 脚本从单文件拆分成公共调度器与 `BossAdapter` 时，应保持现有 `/client-config`、`/get-job-score` 和 `/log-action` 协议，以避免同时重写已验证的评分链路。
