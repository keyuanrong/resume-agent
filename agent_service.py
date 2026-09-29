from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from datetime import date
from typing import Any

from product_store import KeyringUnavailableError, get_api_key, get_product_config
from model_providers import get_provider


class AgentConfigurationError(RuntimeError):
    pass


class AgentRequestError(RuntimeError):
    pass


def _extract_json(content: str) -> dict:
    content = (content or "").strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", content, re.DOTALL)
    if fenced:
        content = fenced.group(1)
    try:
        value = json.loads(content)
    except json.JSONDecodeError as exc:
        start = content.find("{")
        end = content.rfind("}")
        if start < 0 or end <= start:
            raise AgentRequestError("Agent 没有返回有效 JSON") from exc
        try:
            value = json.loads(content[start:end + 1])
        except json.JSONDecodeError as nested_exc:
            raise AgentRequestError("Agent 返回的 JSON 无法解析") from nested_exc
    if not isinstance(value, dict):
        raise AgentRequestError("Agent 返回结果必须是 JSON 对象")
    return value


def _answer_terms(value: Any) -> list[str]:
    if isinstance(value, list):
        parts = value
    else:
        parts = re.split(r'[,，、;；\n]+', str(value or ''))
    return list(dict.fromkeys(str(part).strip() for part in parts if str(part).strip()))


def _strategy_questions(profile: dict) -> list[dict]:
    hints = _answer_terms(profile.get('targetRoleHints'))[:3]
    hint_text = f"（简历提示：{'、'.join(hints)}）" if hints else ''
    return [
        {'id': 'targetRoles', 'question': f'这次优先搜索哪些岗位名称？请按优先级列出{hint_text}'},
        {'id': 'preferredSkills', 'question': '哪些简历中已有的技能或项目方向最该进入岗位匹配词表？'},
        {'id': 'excludedKeywords', 'question': '哪些岗位方向或职责明确不考虑？这些词将用于排除。'},
    ]


def _unsupported_future_risk(risk: str) -> bool:
    if '未来' not in risk:
        return False
    today = date.today()
    years = [int(value) for value in re.findall(r'(?<!\d)(20\d{2})(?!\d)', risk)]
    if not years or any(year > today.year for year in years):
        return False
    months = [
        (int(year), int(month)) for year, month in
        re.findall(r'(?<!\d)(20\d{2})[./-](0?[1-9]|1[0-2])(?!\d)', risk)
    ]
    return not any((year, month) > (today.year, today.month) for year, month in months)


class QwenAgent:
    def __init__(self):
        config = get_product_config(public=False).get("agent", {})
        self.provider_id = config.get('provider') or 'bailian'
        if self.provider_id == 'qwen':
            self.provider_id = 'bailian'
        try:
            provider = get_provider(self.provider_id)
        except ValueError as exc:
            raise AgentConfigurationError(str(exc)) from exc
        try:
            self.api_key = get_api_key(self.provider_id)
        except KeyringUnavailableError as exc:
            raise AgentConfigurationError(str(exc)) from exc
        self.model = str(config.get("model") or "qwen3.8-flash")
        self.base_url = provider.chat_url
        if not self.api_key:
            raise AgentConfigurationError(f"尚未配置{provider.name} API Key")

    def _request(self, messages: list[dict], *, max_tokens: int = 3000) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        if self.provider_id == 'bailian':
            payload['enable_thinking'] = False
        request = urllib.request.Request(
            self.base_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise AgentRequestError(f"Agent API 请求失败（HTTP {exc.code}）") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise AgentRequestError(f"无法连接 Agent API：{exc}") from exc
        try:
            content = result["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AgentRequestError("Agent API 返回结构不符合预期") from exc
        return _extract_json(content)

    def analyze_resume(self, resume: dict) -> dict:
        system = (
            "你是求职策略分析 Agent。只根据候选人简历中真实出现的内容生成画像，不得编造经历。"
            f"今天是 {date.today().isoformat()}。判断时间线时必须比较准确年月；仅有年份不足以断言经历在未来。"
            "没有简历证据的风险不要写入 risks。"
            "返回严格 JSON，字段必须包含 profile、draftStrategy；questions 可以为空列表，补充问题由系统生成。"
            "profile 包含 summary、skills、experienceHighlights、education、targetRoleHints、risks。"
            "draftStrategy 包含 searchKeywords、excludedKeywords、companyBlockKeywords、threshold、greeting、"
            "dailyLimit、deliveryMode、resumeDelivery、targetRoles、preferredSkills、cities、jobType、minimumSalary。"
            "searchKeywords 必须是适合在招聘平台搜索的岗位名称短语，而非单个技能词；"
            "preferredSkills 是简历有证据的技术词；excludedKeywords 只放用户明确排除的方向，不凭猜测硬拦截。"
            "城市、薪资、公司规模、岗位性质和经验要求由招聘网站职位信息提供，不根据简历臆测筛选限制。"
        )
        instruction = (
            "分析这份简历，给出候选人画像和初步岗位词表；不提出面试、Offer、入职时间等问题。"
            "搜索关键词控制在 3 到 8 个；招呼语不超过 100 个中文字符；threshold 为 0 到 100 的整数。"
        )
        if resume.get("kind") == "image":
            content: Any = [
                {"type": "text", "text": instruction},
                {"type": "image_url", "image_url": {"url": resume["dataUrl"]}},
            ]
        else:
            text = str(resume.get("text") or "")
            if len(text) > 60000:
                text = text[:60000]
            content = f"{instruction}\n\n# 简历内容\n{text}"
        result = self._request([
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ])
        profile = result.get('profile') if isinstance(result.get('profile'), dict) else {}
        if isinstance(profile.get('risks'), list):
            profile['risks'] = [
                risk for risk in profile['risks']
                if not _unsupported_future_risk(str(risk))
            ]
        result['profile'] = profile
        result['questions'] = _strategy_questions(profile)
        return result

    def build_strategy(self, profile: dict, draft: dict, questions: list, answers: dict) -> dict:
        system = (
            "你是求职策略 Agent。根据候选人画像、初步策略和用户回答生成最终策略。"
            "必须尊重用户明确的岗位方向和排除限制，不得自行放宽。"
            "回答中的 targetRoles 决定目标岗位和搜索词，preferredSkills 决定技能词，"
            "excludedKeywords 决定硬排除词。招聘网站能提供的城市、薪资、岗位性质、公司规模和经验要求不要向用户追问或猜测。"
            "只使用简历有证据的技能；不要把明确排除的方向写入正向搜索词。"
            "只返回 JSON 对象，字段为 searchKeywords、excludedKeywords、companyBlockKeywords、threshold、"
            "greeting、dailyLimit、deliveryMode、resumeDelivery、targetRoles、preferredSkills、cities、jobType、minimumSalary。"
        )
        data = {"profile": profile, "draftStrategy": draft, "questions": questions, "answers": answers}
        result = self._request([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
        ])
        for field in ('targetRoles', 'preferredSkills'):
            terms = _answer_terms(answers.get(field))
            if terms:
                result[field] = terms
        result['excludedKeywords'] = _answer_terms(answers.get('excludedKeywords'))
        for field in ('cities', 'companyBlockKeywords'):
            result[field] = _answer_terms(answers.get(field))
        if result.get('targetRoles') and _answer_terms(answers.get('targetRoles')):
            result['searchKeywords'] = result['targetRoles'][:8]
        result['jobType'] = str(answers.get('jobType') or '').strip()
        result['minimumSalary'] = str(answers.get('minimumSalary') or '').strip()
        # 词表必须根据最终确认的方向重新生成，不能沿用模型草稿中的评分词。
        result.pop('scoring', None)
        return result

    def evaluate_job(self, profile: dict, strategy: dict, job: dict, rule_result: dict) -> dict:
        system = (
            "你是谨慎的岗位匹配 Agent，只负责规则难以判断的边界岗位。"
            "不要因为标题相似就推荐，必须核对实际职责、硬性要求与候选人真实经历。"
            "只返回 JSON：decision(recommend/reject/review)、score(0-100整数)、confidence(0-1)、"
            "matched(字符串数组)、missing(字符串数组)、risks(字符串数组)、reason(简短中文)。"
        )
        payload = {
            "candidateProfile": profile,
            "strategy": strategy,
            "job": job,
            "ruleResult": {
                "score": rule_result.get("score"),
                "reason": rule_result.get("reason"),
                "keyword": rule_result.get("keyword"),
            },
        }
        result = self._request([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ], max_tokens=1200)
        try:
            result["score"] = max(0, min(100, int(result.get("score", rule_result.get("score", 0)))))
            result["confidence"] = max(0.0, min(1.0, float(result.get("confidence", 0))))
        except (TypeError, ValueError):
            raise AgentRequestError("Agent 返回了无效的分数或置信度")
        if result.get("decision") not in {"recommend", "reject", "review"}:
            result["decision"] = "review"
        return result


def get_agent() -> QwenAgent:
    config = get_product_config(public=False)
    agent = config.get("agent", {})
    if not agent.get("enabled"):
        raise AgentConfigurationError("Agent 当前未开启")
    return QwenAgent()
