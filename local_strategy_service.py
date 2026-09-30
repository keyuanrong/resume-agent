from __future__ import annotations

import re
from typing import Any


# 免费模式只做确定性的本地匹配：不联网、不调用模型，也不推断简历中没有的经历。
# 模板的作用是把简历中真实出现的技能组织成一份可编辑的初稿。
ROLE_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "sales",
        "name": "销售 / 商务拓展",
        "signals": ["销售", "客户开发", "商务谈判", "crm", "销售额", "销售目标", "渠道建设", "回款", "续费", "招投标", "大客户", "线索转化"],
        "roles": ["大客户销售", "客户经理", "商务拓展经理", "渠道销售"],
        "titleTerms": ["销售", "客户经理", "商务拓展", "渠道", "大客户"],
        "negative": ["客服", "售后支持", "行政", "纯运营"],
    },
    {
        "id": "marketing_operations",
        "name": "市场 / 运营",
        "signals": ["用户运营", "内容运营", "活动运营", "市场营销", "品牌", "增长", "投放", "转化率", "社群", "新媒体", "公众号", "短视频"],
        "roles": ["用户运营", "内容运营", "市场专员", "活动运营"],
        "titleTerms": ["运营", "市场", "增长", "品牌", "新媒体"],
        "negative": ["电话销售", "客服", "行政", "后端开发"],
    },
    {
        "id": "customer_service",
        "name": "客户服务 / 售后",
        "signals": ["客户服务", "客服", "售后", "工单", "客诉", "客户满意度", "呼叫中心", "问题处理", "服务流程"],
        "roles": ["客户服务专员", "售后支持", "客户成功经理"],
        "titleTerms": ["客服", "客户服务", "售后", "客户成功"],
        "negative": ["销售", "地推", "纯开发", "机械设计"],
    },
    {
        "id": "hr_admin",
        "name": "人力资源 / 行政",
        "signals": ["招聘", "人力资源", "员工关系", "绩效", "薪酬", "培训", "行政管理", "考勤", "人才盘点", "hrbp"],
        "roles": ["人力资源专员", "招聘专员", "HRBP", "行政专员"],
        "titleTerms": ["人力资源", "招聘", "hrbp", "行政"],
        "negative": ["销售", "客服", "后端开发", "机械设计"],
    },
    {
        "id": "finance",
        "name": "财务 / 会计",
        "signals": ["会计", "财务", "审计", "税务", "报表", "总账", "应收", "应付", "成本核算", "预算", "用友", "金蝶"],
        "roles": ["会计", "财务专员", "审计专员", "财务分析师"],
        "titleTerms": ["会计", "财务", "审计", "税务"],
        "negative": ["销售", "客服", "前端开发", "机械设计"],
    },
    {
        "id": "robot_vla",
        "name": "VLA / 具身智能",
        "signals": ["vla", "vision-language-action", "lerobot", "smolvla", "openvla", "pi0.5", "π0.5", "pi0", "π0", "act", "mujoco", "机器人操作", "具身智能", "机械臂", "模仿学习", "在线强化学习", "离线强化学习"],
        "roles": ["VLA算法工程师", "具身智能算法工程师", "机器人学习算法工程师"],
        "titleTerms": ["vla", "具身智能", "机器人学习", "具身操作", "机器人操作"],
        "negative": ["slam", "定位建图", "路径规划", "运动控制", "运控", "机械设计", "电气设计", "销售"],
    },
    {
        "id": "ai_llm",
        "name": "大模型 / AI 应用",
        "signals": ["llm", "大模型", "agent", "智能体", "rag", "prompt", "提示词", "mcp", "langchain", "模型微调", "function calling"],
        "roles": ["AI应用工程师", "大模型应用工程师", "智能体开发工程师"],
        "titleTerms": ["ai应用", "大模型应用", "智能体", "agent", "llm"],
        "negative": ["销售", "客服", "纯运营", "硬件工程师", "机械设计"],
    },
    {
        "id": "backend",
        "name": "后端开发",
        "signals": ["java", "spring", "spring boot", "python", "django", "flask", "fastapi", "golang", "go语言", "node.js", "mysql", "redis", "微服务"],
        "roles": ["后端开发工程师", "服务端开发工程师", "软件开发工程师"],
        "titleTerms": ["后端", "服务端", "java开发", "python开发", "golang开发"],
        "negative": ["销售", "前端开发", "机械设计", "硬件工程师", "运维专员"],
    },
    {
        "id": "frontend",
        "name": "前端开发",
        "signals": ["javascript", "typescript", "react", "vue", "angular", "html", "css", "webpack", "vite", "小程序"],
        "roles": ["前端开发工程师", "Web前端工程师", "客户端开发工程师"],
        "titleTerms": ["前端", "web前端", "前端开发", "javascript"],
        "negative": ["销售", "后端开发", "嵌入式", "机械设计", "硬件工程师"],
    },
    {
        "id": "data",
        "name": "数据分析 / 数据工程",
        "signals": ["sql", "tableau", "power bi", "excel", "pandas", "spark", "hadoop", "数据分析", "数据仓库", "etl", "统计分析"],
        "roles": ["数据分析师", "数据工程师", "商业分析师"],
        "titleTerms": ["数据分析", "数据工程", "商业分析", "数据开发"],
        "negative": ["销售", "客服", "前端开发", "机械设计", "硬件工程师"],
    },
    {
        "id": "ml",
        "name": "机器学习 / 算法",
        "signals": ["pytorch", "tensorflow", "机器学习", "深度学习", "transformer", "计算机视觉", "opencv", "nlp", "推荐算法", "模型训练"],
        "roles": ["机器学习算法工程师", "算法工程师", "人工智能工程师"],
        "titleTerms": ["机器学习", "算法工程师", "深度学习", "人工智能"],
        "negative": ["销售", "纯运营", "前端开发", "机械设计", "硬件工程师"],
    },
    {
        "id": "devops",
        "name": "运维 / DevOps",
        "signals": ["linux", "docker", "kubernetes", "k8s", "jenkins", "ansible", "prometheus", "grafana", "terraform", "devops", "sre", "云原生"],
        "roles": ["DevOps工程师", "SRE工程师", "运维开发工程师"],
        "titleTerms": ["devops", "sre", "运维开发", "平台工程"],
        "negative": ["销售", "桌面运维", "网络销售", "机械设计", "前端开发"],
    },
    {
        "id": "product",
        "name": "产品经理",
        "signals": ["产品经理", "需求分析", "原型设计", "axure", "figma", "用户研究", "竞品分析", "产品规划", "需求文档", "prd"],
        "roles": ["产品经理", "产品助理", "AI产品经理"],
        "titleTerms": ["产品经理", "产品助理", "产品策划", "ai产品"],
        "negative": ["销售", "客服", "机械设计", "硬件工程师", "纯开发"],
    },
    {
        "id": "embedded",
        "name": "嵌入式 / 硬件",
        "signals": ["嵌入式", "stm32", "单片机", "rtos", "freertos", "pcb", "arm", "c语言", "驱动开发", "串口", "can总线"],
        "roles": ["嵌入式软件工程师", "硬件工程师", "驱动开发工程师"],
        "titleTerms": ["嵌入式", "硬件工程师", "驱动开发", "单片机"],
        "negative": ["销售", "前端开发", "产品经理", "纯运营"],
    },
    {
        "id": "mechanical",
        "name": "机械 / 自动化",
        "signals": ["solidworks", "autocad", "机械设计", "结构设计", "plc", "西门子", "电气设计", "机器人", "自动化", "有限元"],
        "roles": ["机械设计工程师", "自动化工程师", "机器人工程师"],
        "titleTerms": ["机械设计", "自动化工程师", "机器人工程师", "结构工程师"],
        "negative": ["销售", "前端开发", "后端开发", "纯运营"],
    },
]

JOB_SUFFIXES = ("工程师", "实习生", "经理", "分析师", "研究员", "设计师", "开发", "算法")


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _contains(text: str, term: str) -> bool:
    normalized = text.lower()
    needle = term.lower()
    if re.fullmatch(r'(?:π|pi)0', needle):
        return bool(re.search(rf'(?<![a-z0-9]){re.escape(needle)}(?![.\d])', normalized))
    if re.fullmatch(r"[a-z0-9+.#-]+", needle):
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", normalized))
    return needle in normalized


def _unique(values: list[str], limit: int | None = None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        value = _normalize(value)
        key = value.lower()
        if not value or key in seen:
            continue
        seen.add(key)
        result.append(value)
        if limit and len(result) >= limit:
            break
    return result


def _resume_role_hints(text: str) -> list[str]:
    hints: list[str] = []
    for line in text.splitlines():
        line = _normalize(line).strip("：:|·- ")
        if not line or len(line) > 45:
            continue
        if any(prefix in line for prefix in ("求职意向", "目标岗位", "求职目标", "期望职位")):
            value = re.split(r"[：:]", line, maxsplit=1)[-1]
            hints.extend(re.split(r"[,，、/|]", value))
        elif len(line) <= 22 and any(line.endswith(suffix) for suffix in JOB_SUFFIXES):
            hints.append(line)
    return _unique(hints, 5)


def _template_matches(text: str, filename: str = "") -> list[tuple[dict[str, Any], list[str]]]:
    ranked = []
    role_hints = _resume_role_hints(text)
    for template in ROLE_TEMPLATES:
        matched = [term for term in template["signals"] if _contains(text, term)]
        filename_evidence = [
            term for term in template["titleTerms"] + template["signals"]
            if filename and _contains(filename, term)
        ]
        intent_evidence = [
            hint for hint in role_hints
            if any(_contains(hint, term) or _contains(term, hint) for term in template["titleTerms"])
        ]
        if matched or filename_evidence or intent_evidence:
            # 用户主动选择的文件名和简历明确写出的求职意向，比项目经历中的
            # 技术名词更能代表这份简历的投递方向。
            direction_score = len(matched) + len(filename_evidence) * 6 + len(intent_evidence) * 8
            ranked.append((template, matched, direction_score))
    ranked.sort(key=lambda item: (item[2], len(item[1]), sum(len(term) for term in item[1])), reverse=True)
    return [(template, matched) for template, matched, _ in ranked]


def analyze_local_resume(resume_text: str, *, filename: str = "") -> dict:
    text = _normalize(resume_text)
    if len(text) < 40:
        raise ValueError("简历可提取文字太少，无法在本地生成可靠词库")
    matches = _template_matches(text, filename)
    if not matches:
        raise ValueError("本地模板暂时无法识别这份简历的岗位方向，请手动填写目标岗位和技能")
    candidates = []
    best_count = max(1, len(matches[0][1]))
    for template, evidence in matches[:4]:
        candidates.append({
            "id": template["id"],
            "name": template["name"],
            "evidence": evidence[:10],
            "roles": template["roles"],
            "confidence": round(min(1.0, len(evidence) / best_count), 2),
        })
    return {"candidateDirections": candidates, "recommendedDirectionId": candidates[0]["id"]}


def build_scoring_from_strategy(strategy: dict) -> dict:
    """没有完整词库时，根据用户输入构造保守的通用词库。"""
    search = _unique([str(value) for value in strategy.get("searchKeywords", [])], 10)
    roles = _unique([str(value) for value in strategy.get("targetRoles", [])], 10)
    skills = _unique([str(value) for value in strategy.get("preferredSkills", [])], 30)
    excluded = _unique([str(value) for value in strategy.get("excludedKeywords", [])], 30)
    title_terms = _unique(search + roles, 20)
    return {
        "title_block_keywords": {term: 100 for term in excluded},
        "title_penalty_keywords": {},
        "title_strong_keywords": {term: max(68, 86 - index * 2) for index, term in enumerate(title_terms)},
        "title_medium_keywords": {},
        "detail_infra_keywords": {term: 10 for term in skills[:16]},
        "detail_support_keywords": {term: 5 for term in skills[16:30]},
        "detail_negative_keywords": {term: 18 for term in excluded},
        "title_core_keywords": [],
        "explicit_vla_keywords": [],
        "detail_policy_model_keywords": [],
        "detail_robot_context_keywords": [],
        "detail_model_work_keywords": [],
        "detail_rl_dominant_keywords": [],
        "detail_data_engineering_keywords": [],
        "detail_localization_keywords": [],
        "title_data_engineering_keywords": [],
        "title_control_keywords": [],
        "title_localization_keywords": [],
    }


def generate_local_strategy(
    resume_text: str,
    *,
    resume_id: str | None = None,
    filename: str = "",
    direction_id: str | None = None,
    user_excluded: list[str] | None = None,
    target_roles: list[str] | None = None,
    preferred_skills: list[str] | None = None,
) -> dict:
    text = _normalize(resume_text)
    if len(text) < 40:
        raise ValueError("简历可提取文字太少，无法在本地生成可靠词库")

    analysis = analyze_local_resume(resume_text, filename=filename)
    matches = _template_matches(text, filename)
    if not matches:
        raise ValueError("本地模板暂时无法识别这份简历的岗位方向，请手动填写目标岗位和技能")

    selected = next((item for item in matches if item[0]["id"] == direction_id), None)
    if direction_id and not selected:
        template = next((item for item in ROLE_TEMPLATES if item["id"] == direction_id), None)
        if not template:
            raise ValueError("选择的岗位方向不存在")
        selected = (template, [term for term in template["signals"] if _contains(text, term)])
    primary_template, primary_skills = selected or matches[0]
    resume_hints = [
        hint for hint in _resume_role_hints(resume_text)
        if any(_contains(hint, term) or _contains(term, hint) for term in primary_template["titleTerms"])
    ]
    target_roles = _unique(target_roles, 8) if target_roles else _unique(resume_hints + primary_template["roles"], 6)
    # 个人技能词只取用户选定方向的证据，避免嵌入式方向仍把简历里的
    # VLA 经历当成岗位加分项，反之亦然。
    matched_skills = _unique(primary_skills, 28)
    ignored_skills: list[str] = []
    if preferred_skills:
        evidence_terms = {term.lower() for term in primary_skills}
        matched_skills = _unique([
            term for term in preferred_skills
            if term.lower() in evidence_terms and _contains(text, term)
        ], 28)
        accepted = {term.lower() for term in matched_skills}
        ignored_skills = _unique([
            term for term in preferred_skills if term.lower() not in accepted
        ], 28)
    search_keywords = target_roles[:]
    # 只有用户明确选择的词才做硬拦截。模板中的相邻方向只参与扣分。
    excluded = _unique([str(term) for term in (user_excluded or [])], 24)
    direction_negative = _unique(primary_template["negative"], 16)

    scoring = build_scoring_from_strategy({
        "searchKeywords": search_keywords,
        "targetRoles": target_roles,
        "preferredSkills": matched_skills,
        "excludedKeywords": excluded,
    })
    # 简历命中的方向词比普通技能更适合用于岗位标题匹配。
    scoring["title_medium_keywords"] = {
        term: max(38, 58 - index * 2)
        for index, term in enumerate(_unique(primary_template["titleTerms"], 16))
    }
    scoring["title_block_keywords"] = {term: 100 for term in excluded}
    scoring["title_penalty_keywords"] = {
        term: 30 for term in direction_negative if term not in scoring["title_block_keywords"]
    }
    scoring["detail_infra_keywords"] = {
        term: max(8, 14 - index // 4)
        for index, term in enumerate(matched_skills[:18])
    }
    scoring["detail_negative_keywords"] = {
        term: 14 for term in direction_negative if term not in scoring["title_block_keywords"]
    }

    strategy = {
        "confirmed": False,
        "source": "local_resume",
        "resumeId": resume_id,
        "searchKeywords": search_keywords,
        "excludedKeywords": excluded,
        "companyBlockKeywords": [],
        "threshold": 80,
        "jobsPerKeyword": 20,
        "deliveryMode": "review",
        "resumeDelivery": "platform_resume",
        "targetRoles": target_roles,
        "preferredSkills": matched_skills,
        "scoring": scoring,
    }
    evidence_lines = _unique([
        _normalize(line)[:240]
        for line in resume_text.splitlines()
        if len(_normalize(line)) >= 20 and any(_contains(line, skill) for skill in matched_skills)
    ], 8)
    profile = {
        "summary": f"已按“{primary_template['name']}”方向生成个人词库",
        "skills": matched_skills,
        "experienceHighlights": evidence_lines,
        "targetRoleHints": target_roles,
        "templateIds": [primary_template["id"]],
    }
    return {
        "profile": profile,
        "ignoredPreferredSkills": ignored_skills,
        "candidateDirections": analysis["candidateDirections"],
        "selectedDirectionId": primary_template["id"],
        "draftStrategy": strategy,
        "warnings": [
            "本结果由本地词典生成，没有调用 Agent，也不会把简历发送到第三方。",
            "请删除简历中出现但你不想从事的方向，并在确认前检查正向词和排除词。",
        ],
    }
