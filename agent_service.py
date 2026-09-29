from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

from product_store import get_api_key, get_product_config


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


class QwenAgent:
    def __init__(self):
        config = get_product_config(public=False).get("agent", {})
        self.api_key = get_api_key()
        self.model = str(config.get("model") or "qwen3.8-flash")
        self.base_url = str(config.get("baseUrl") or "").strip()
        if not self.api_key:
            raise AgentConfigurationError("尚未配置阿里云百炼 API Key")
        if not self.base_url.startswith("https://"):
            raise AgentConfigurationError("Agent API 地址必须使用 HTTPS")

    def _request(self, messages: list[dict], *, max_tokens: int = 3000) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
            "enable_thinking": False,
        }
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
            detail = exc.read().decode("utf-8", errors="ignore")[:500]
            raise AgentRequestError(f"Agent API 请求失败（HTTP {exc.code}）：{detail}") from exc
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
            "返回严格 JSON，字段必须包含 profile、questions、draftStrategy。questions 为 5 到 8 个简短中文问题。"
            "profile 包含 summary、skills、experienceHighlights、education、targetRoleHints、risks。"
            "draftStrategy 包含 searchKeywords、excludedKeywords、companyBlockKeywords、threshold、greeting、"
            "dailyLimit、deliveryMode、resumeDelivery、targetRoles、preferredSkills、cities、jobType、minimumSalary。"
        )
        instruction = (
            "分析这份简历，先给出候选人画像和初步求职策略，再提出只有用户本人才能确认的问题。"
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
        return self._request([
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ])

    def build_strategy(self, profile: dict, draft: dict, questions: list, answers: dict) -> dict:
        system = (
            "你是求职策略 Agent。根据候选人画像、初步策略和用户回答生成最终策略。"
            "必须尊重用户明确的城市、薪资、岗位、公司和发送限制，不得自行放宽。"
            "只返回 JSON 对象，字段为 searchKeywords、excludedKeywords、companyBlockKeywords、threshold、"
            "greeting、dailyLimit、deliveryMode、resumeDelivery、targetRoles、preferredSkills、cities、jobType、minimumSalary。"
        )
        data = {"profile": profile, "draftStrategy": draft, "questions": questions, "answers": answers}
        return self._request([
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(data, ensure_ascii=False)},
        ])

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
    if agent.get("provider") != "qwen":
        raise AgentConfigurationError("第一版目前只接入阿里云百炼 Qwen")
    return QwenAgent()
