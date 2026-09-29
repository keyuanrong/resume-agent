from datetime import datetime
import asyncio
import html
import random
import json
import re
import uuid
import copy
from pathlib import Path
from typing import Any
from fastapi import FastAPI, Body, HTTPException
from starlette.responses import HTMLResponse, Response
from core import replyMsg, isNeedResume, isNeedWorks, evaluateSingleRouteDelivery
from schema import Msg
from config import Config
from agent_service import AgentConfigurationError, AgentRequestError, get_agent, _answer_terms, _strategy_questions
from local_strategy_service import analyze_local_resume, build_scoring_from_strategy, generate_local_strategy
from platforms import list_platforms
from product_store import get_product_config, list_resumes, save_product_config, RESUME_DIR
from product_store import get_api_key, KeyringUnavailableError
from model_providers import get_provider, list_provider_models, ModelDiscoveryError
from resume_service import delete_resume, get_resume_for_agent, get_resume_text_local, save_resume


app = FastAPI()
LOG_PATH = Path(__file__).resolve().parent / 'job_decisions.jsonl'
ACTION_LOG_PATH = Path(__file__).resolve().parent / 'job_actions.jsonl'
STATIC_PATH = Path(__file__).resolve().parent / 'static'
INVALID_COMPANY_NAMES = {'', '公司', '公司信息', '企业', '企业信息', '工商信息', '查看公司', '所属公司'}


def _clean_company(value: Any) -> str:
    company = re.sub(r'\s+', ' ', str(value or '')).strip()
    return '' if company in INVALID_COMPANY_NAMES else company


def _zhaopin_contact_attempt_state(company: str, title: str) -> str:
    normalized_company = re.sub(r'\s+', '', company).lower()
    normalized_title = re.sub(r'\s+', '', title).lower()
    if not normalized_company or not normalized_title:
        return 'none'
    for action in reversed(_read_jsonl(ACTION_LOG_PATH)):
        if action.get('platform') != 'zhaopin':
            continue
        action_company = re.sub(r'\s+', '', str(action.get('company') or '')).lower()
        action_title = re.sub(r'\s+', '', str(action.get('title') or '')).lower()
        if action_company != normalized_company or action_title != normalized_title:
            continue
        action_name = action.get('action')
        if action_name == 'zhaopin_greeting_sent':
            return 'attempted'
        if action_name == 'zhaopin_contact_not_sent':
            return 'retry_safe'
        if action_name == 'zhaopin_greeting_failed' and re.search(
            r'凭证失效|登录(?:已)?失效|登录过期|请重新登录',
            str(action.get('reason') or ''),
        ):
            return 'retry_safe'
        if action_name == 'zhaopin_contact_clicking':
            return 'attempted'
    return 'none'


def _json_line(record: dict) -> str:
    """避免职位描述中的 Unicode 行/段分隔符触发编辑器异常换行警告。"""
    return json.dumps(record, ensure_ascii=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')


def _extract_raw_section(raw_job: str, heading: str) -> str:
    match = re.search(
        rf'^# {re.escape(heading)}\s*\n(.*?)(?=\n\s*\n# |\Z)',
        raw_job or '',
        flags=re.MULTILINE | re.DOTALL,
    )
    return match.group(1).strip() if match else ''


def _normalize_job_payload(job: Any) -> tuple[str, str, str, str]:
    if isinstance(job, dict):
        title = str(job.get('title') or '').strip()
        company = _clean_company(job.get('company'))
        salary = str(job.get('salary') or '').strip()
        detail = str(job.get('detail') or '').strip()
        platform = str(job.get('platform') or 'boss').strip().lower()
        raw_job = f'# 职位名称\n{title}\n\n# 薪资范围\n{salary}\n\n# 职位描述\n{detail}'
        return raw_job, company, salary, platform
    raw_job = str(job or '')
    return raw_job, '', _extract_raw_section(raw_job, '薪资范围'), 'boss'


def append_job_decision_log(result: dict, raw_job: str, delay_ms: int):
    log_record = {
        'loggedAt': datetime.now().isoformat(timespec='seconds'),
        'decisionId': result.get('decisionId'),
        'platform': result.get('platform'),
        'company': result.get('company'),
        'title': result.get('title'),
        'salary': result.get('salary'),
        'detail': result.get('detail'),
        'matchedField': result.get('matched_field'),
        'keyword': result.get('keyword'),
        'score': result.get('score'),
        'introduce': result.get('introduce'),
        'resumeIndex': result.get('resumeIndex'),
        'titleScore': result.get('title_score'),
        'detailScore': result.get('detail_score'),
        'comboScore': result.get('combo_score'),
        'titlePenaltyScore': result.get('title_penalty_score'),
        'penaltyScore': result.get('penalty_score'),
        'titleCoreMatches': result.get('title_core_matches'),
        'explicitVlaMatches': result.get('explicit_vla_matches'),
        'policyModelMatches': result.get('policy_model_matches'),
        'robotContextMatches': result.get('robot_context_matches'),
        'modelWorkMatches': result.get('model_work_matches'),
        'dominantProfile': result.get('dominant_profile'),
        'highConfidenceMatch': result.get('high_confidence_match'),
        'reason': result.get('reason'),
        'agentUsed': result.get('agent_used', False),
        'agentDecision': result.get('agent_decision'),
        'agentConfidence': result.get('agent_confidence'),
        'agentReason': result.get('agent_reason'),
        'delayMs': delay_ms,
        'rawJob': raw_job,
    }
    with LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(_json_line(log_record) + '\n')


def append_job_action_log(action: dict):
    action_record = {
        'loggedAt': datetime.now().isoformat(timespec='seconds'),
        **action,
    }
    with ACTION_LOG_PATH.open('a', encoding='utf-8') as f:
        f.write(_json_line(action_record) + '\n')


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    records = []
    with path.open('r', encoding='utf-8') as f:
        for line in f:
            try:
                record = json.loads(line)
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(record, dict):
                records.append(record)
    return records


REPORT_ACTION_RESULTS = {
    'job_skip': '读取跳过',
    'job_company_blocked': '公司屏蔽',
    'job_company_unknown': '公司未识别',
    'job_already_talked': '已沟通过',
    'job_below_threshold': '已跳过',
    'job_screened_only': '仅筛选',
    'job_requires_review': '等待审核',
    'greet_queued': '准备沟通',
    'chat_open_requested': '已请求沟通',
    'greet_sent': '已沟通',
    'greet_api_succeeded': '已沟通',
    'zhaopin_greeting_sent': '已沟通',
    'greet_api_failed': '沟通失败',
    'greet_queue_failed': '沟通失败',
    'greet_failed': '沟通失败',
    'greet_timeout': '沟通超时',
    'zhaopin_greeting_failed': '沟通失败',
    'zhaopin_greeting_cancelled': '已取消',
    'zhaopin_contact_not_sent': '未发送',
    'zhaopin_duplicate_attempt_blocked': '重复沟通已拦截',
    'greet_duplicate_blocked': '重复跳过',
    'platform_test_planned': '测试模式已拦截',
    'platform_live_planned': '等待人工确认',
    'platform_test_failed': '测试链路失败',
}


def build_job_report_rows() -> list[dict]:
    decisions = [
        decision for decision in _read_jsonl(LOG_PATH)
        if decision.get('introduce') != '测试用打招呼语'
    ]
    actions = _read_jsonl(ACTION_LOG_PATH)
    result_by_decision_id = {}
    planned_by_decision_id = {}
    actions_by_job = {}
    for action in actions:
        result = REPORT_ACTION_RESULTS.get(action.get('action'))
        if not result:
            continue
        decision_id = action.get('decisionId')
        if decision_id:
            result_by_decision_id[decision_id] = result
            planned = action.get('plannedActions')
            if isinstance(planned, list):
                planned_by_decision_id[decision_id] = '、'.join(
                    str(item.get('label') or item.get('type') or '') if isinstance(item, dict) else str(item)
                    for item in planned
                    if item
                )
        key = (action.get('title') or '', action.get('salary') or '')
        actions_by_job.setdefault(key, []).append((action.get('loggedAt') or '', result))

    rows = []
    for decision in decisions:
        raw_job = decision.get('rawJob') or ''
        title = decision.get('title') or _extract_raw_section(raw_job, '职位名称') or '未识别岗位'
        salary = decision.get('salary') or _extract_raw_section(raw_job, '薪资范围') or '未记录'
        company = _clean_company(decision.get('company')) or '未记录'
        logged_at = decision.get('loggedAt') or ''
        result = result_by_decision_id.get(decision.get('decisionId'))
        if not result:
            candidates = actions_by_job.get((title, salary), [])
            nearby = []
            for item in candidates:
                try:
                    seconds = (datetime.fromisoformat(item[0]) - datetime.fromisoformat(logged_at)).total_seconds()
                except (TypeError, ValueError):
                    continue
                if 0 <= seconds <= 120:
                    nearby.append(item)
            if nearby:
                result = nearby[-1][1]
        if not result:
            result = '已评分'
        rows.append({
            'loggedAt': logged_at,
            'platform': decision.get('platform') or 'boss',
            'company': company,
            'title': title,
            'salary': salary,
            'score': decision.get('score'),
            'plannedActions': planned_by_decision_id.get(decision.get('decisionId')) or '无',
            'result': result,
        })

    # 已聊过和详情读取失败的岗位不会进入评分接口，单独补入报告。
    for action in actions:
        if action.get('action') not in {
            'job_already_talked', 'job_skip', 'job_company_blocked', 'job_company_unknown',
            'platform_test_failed',
        }:
            continue
        rows.append({
            'loggedAt': action.get('loggedAt') or '',
            'platform': action.get('platform') or 'boss',
            'company': _clean_company(action.get('company')) or '未记录',
            'title': action.get('title') or '未识别岗位',
            'salary': action.get('salary') or '未记录',
            'score': action.get('score'),
            'plannedActions': '无',
            'result': REPORT_ACTION_RESULTS[action.get('action')],
        })
    rows.sort(key=lambda row: row['loggedAt'], reverse=True)
    return rows


@app.get('/job-report', response_class=HTMLResponse, summary='查看岗位处理报告')
async def get_job_report():
    rows = build_job_report_rows()
    table_rows = ''.join(
        '<tr>'
        f'<td>{html.escape((row["loggedAt"] or "未记录").replace("T", " "))}</td>'
        f'<td>{html.escape(str(row["platform"]))}</td>'
        f'<td>{html.escape(str(row["company"]))}</td>'
        f'<td>{html.escape(str(row["title"]))}</td>'
        f'<td>{html.escape(str(row["salary"]))}</td>'
        f'<td class="score">{html.escape(str(row["score"] if row["score"] is not None else "-"))}</td>'
        f'<td>{html.escape(str(row.get("plannedActions") or "无"))}</td>'
        f'<td>{html.escape(str(row["result"]))}</td>'
        '</tr>'
        for row in rows
    )
    page = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>岗位处理记录</title><style>
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:24px;color:#1f2937;background:#f6f7f9}}
.wrap{{max-width:1400px;margin:auto}}h1{{font-size:24px;margin:0 0 8px}}.meta{{color:#6b7280;margin-bottom:16px}}
input{{width:320px;max-width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;margin-bottom:14px}}
.table-wrap{{overflow:auto;background:white;border:1px solid #e5e7eb;border-radius:10px}}
table{{width:100%;border-collapse:collapse;white-space:nowrap}}th,td{{padding:10px 12px;border-bottom:1px solid #eee;text-align:left}}
th{{position:sticky;top:0;background:#f9fafb}}tr:hover{{background:#f9fafb}}.score{{font-weight:700}}
</style></head><body><div class="wrap"><h1>岗位处理记录</h1>
<div class="meta">共 {len(rows)} 条记录；新版本开始记录公司名称，旧记录显示“未记录”。</div>
<input id="filter" placeholder="搜索公司、岗位、结果……">
<div class="table-wrap"><table><thead><tr><th>时间</th><th>平台</th><th>公司</th><th>岗位</th><th>薪资</th><th>分数</th><th>预计动作</th><th>结果</th></tr></thead>
<tbody id="rows">{table_rows}</tbody></table></div></div>
<script>document.getElementById('filter').addEventListener('input',function(){{const q=this.value.toLowerCase();document.querySelectorAll('#rows tr').forEach(r=>r.hidden=!r.innerText.toLowerCase().includes(q));}});</script>
</body></html>'''
    return HTMLResponse(page)


def _active_strategy() -> dict | None:
    config = get_product_config(public=False)
    strategy = config.get('strategy') or {}
    return strategy if strategy.get('confirmed') else None


def _effective_client_config() -> dict:
    client = copy.deepcopy(Config.get_client_config())
    product_config = get_product_config(public=False)
    strategy = _active_strategy()
    if not strategy:
        # 新控制台尚未确认策略时保持只读安全状态，避免继承旧配置直接发送。
        client.setdefault('frontend', {})['onlyGreet'] = True
        client['productMode'] = product_config.get('mode', 'manual')
        client['deliveryMode'] = 'review'
        client['executionMode'] = product_config.get('executionMode', 'test')
        client['platforms'] = copy.deepcopy(product_config.get('platforms', {}))
        return client
    keywords = [str(item).strip() for item in strategy.get('searchKeywords', []) if str(item).strip()]
    if keywords:
        client['tags'] = keywords
    greeting = str(strategy.get('greeting') or '').strip()
    if greeting:
        client['introduce'] = greeting
    frontend = client.setdefault('frontend', {})
    frontend['thread'] = max(0, min(100, _int_or_default(strategy.get('threshold'), frontend.get('thread', 80))))
    frontend['companyBlockKeywords'] = [
        str(item).strip() for item in strategy.get('companyBlockKeywords', []) if str(item).strip()
    ]
    daily_limit = max(0, _int_or_default(strategy.get('dailyLimit'), 0))
    if daily_limit:
        frontend['maxJobsPerRun'] = daily_limit
    # 仅自动投递模式才进入现有的 Boss 新消息检测/平台简历发送流程。
    # “只筛选”和“审核后发送”都不会由脚本自动联系候选岗位。
    execution_mode = product_config.get('executionMode', 'test')
    frontend['onlyGreet'] = strategy.get('deliveryMode') != 'auto' or execution_mode != 'live'
    client['productMode'] = product_config.get('mode', 'manual')
    client['deliveryMode'] = strategy.get('deliveryMode', 'review')
    client['executionMode'] = execution_mode
    client['platforms'] = copy.deepcopy(product_config.get('platforms', {}))
    client['searchFilters'] = {
        'cities': strategy.get('cities', []),
        'jobType': strategy.get('jobType', ''),
        'minimumSalary': strategy.get('minimumSalary', ''),
    }
    client['resumeDelivery'] = strategy.get('resumeDelivery', 'platform_resume')
    client['resumeId'] = strategy.get('resumeId')
    return client


def _split_terms(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in re.split(r'[,，\n]+', str(value or '')) if item.strip()]


def _int_or_default(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


SCORING_MAP_FIELDS = {
    'title_block_keywords', 'title_penalty_keywords', 'title_strong_keywords',
    'title_medium_keywords', 'detail_infra_keywords', 'detail_support_keywords',
    'detail_negative_keywords',
}
SCORING_LIST_FIELDS = {
    'title_core_keywords', 'explicit_vla_keywords', 'detail_policy_model_keywords',
    'detail_robot_context_keywords', 'detail_model_work_keywords',
    'detail_rl_dominant_keywords', 'detail_data_engineering_keywords',
    'detail_localization_keywords', 'title_data_engineering_keywords',
    'title_control_keywords', 'title_localization_keywords',
}


def _normalize_score_map(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    result = {}
    for raw_keyword, raw_score in value.items():
        keyword = str(raw_keyword or '').strip()
        if keyword:
            result[keyword] = max(0, min(100, _int_or_default(raw_score, 0)))
    return result


def _normalize_scoring(value: Any, strategy: dict) -> dict:
    scoring = value if isinstance(value, dict) else {}
    has_rules = any(
        bool(scoring.get(field))
        for field in SCORING_MAP_FIELDS | SCORING_LIST_FIELDS
    )
    if not has_rules:
        scoring = build_scoring_from_strategy(strategy)
    normalized = {field: _normalize_score_map(scoring.get(field)) for field in SCORING_MAP_FIELDS}
    normalized.update({field: _split_terms(scoring.get(field)) for field in SCORING_LIST_FIELDS})
    return normalized


def _normalize_strategy(strategy: dict, *, source: str, confirmed: bool) -> dict:
    normalized = dict(strategy or {})
    for key in ('searchKeywords', 'excludedKeywords', 'companyBlockKeywords', 'targetRoles', 'preferredSkills', 'cities'):
        normalized[key] = _split_terms(normalized.get(key))
    normalized['threshold'] = max(0, min(100, _int_or_default(normalized.get('threshold'), 80)))
    normalized['dailyLimit'] = max(1, min(1000, _int_or_default(normalized.get('dailyLimit'), 30)))
    if normalized.get('deliveryMode') not in {'screen_only', 'review', 'auto'}:
        normalized['deliveryMode'] = 'review'
    if normalized.get('resumeDelivery') not in {'platform_resume', 'pdf', 'image', 'after_reply'}:
        normalized['resumeDelivery'] = 'platform_resume'
    normalized['scoring'] = _normalize_scoring(normalized.get('scoring'), normalized)
    normalized['source'] = source
    normalized['confirmed'] = confirmed
    return normalized


@app.get('/', response_class=HTMLResponse, summary='产品控制台')
async def product_home():
    index_path = STATIC_PATH / 'index.html'
    if not index_path.exists():
        return HTMLResponse('<h1>Resume Agent</h1><p>控制台资源缺失。</p>', status_code=500)
    return HTMLResponse(index_path.read_text(encoding='utf-8'))


@app.get('/assets/{asset_name}', summary='控制台静态资源')
async def product_asset(asset_name: str):
    allowed = {'app.js': 'application/javascript; charset=utf-8', 'styles.css': 'text/css; charset=utf-8'}
    if asset_name not in allowed:
        raise HTTPException(status_code=404, detail='资源不存在')
    path = STATIC_PATH / asset_name
    if not path.exists():
        raise HTTPException(status_code=404, detail='资源不存在')
    return Response(path.read_bytes(), media_type=allowed[asset_name])


@app.get('/api/product-config', summary='获取产品配置')
async def api_get_product_config():
    try:
        return get_product_config(public=True)
    except KeyringUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.put('/api/product-config', summary='更新产品配置')
async def api_update_product_config(payload: dict = Body(...)):
    try:
        return save_product_config(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyringUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post('/api/agent/models', summary='查询服务商可用模型')
async def api_agent_models(payload: dict = Body(...)):
    provider = str(payload.get('provider') or '')
    try:
        get_provider(provider)
        api_key = str(payload.get('apiKey') or '').strip() or get_api_key(provider)
        models = await asyncio.to_thread(list_provider_models, provider, api_key)
        return {'provider': provider, 'models': models}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyringUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ModelDiscoveryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get('/api/platforms', summary='获取招聘平台能力')
async def api_platforms():
    config = get_product_config(public=False)
    enabled = config.get('platforms', {})
    return [
        {**platform, 'enabled': bool(enabled.get(platform['id'], {}).get('enabled'))}
        for platform in list_platforms()
    ]


@app.get('/api/resumes', summary='获取简历列表')
async def api_resumes():
    return list_resumes()


@app.post('/api/resumes', summary='上传本地简历')
async def api_upload_resume(payload: dict = Body(...)):
    try:
        return save_resume(
            str(payload.get('name') or 'resume'),
            str(payload.get('mimeType') or ''),
            str(payload.get('dataBase64') or ''),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete('/api/resumes/{resume_id}', summary='移除上传错误的本地简历')
async def api_delete_resume(resume_id: str):
    try:
        deleted = delete_resume(resume_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    config = get_product_config(public=False)
    if config.get('strategy', {}).get('resumeId') == resume_id:
        save_product_config({'strategy': {'resumeId': None, 'confirmed': False}})
    return {'success': True, 'id': resume_id, 'name': deleted.get('name')}


@app.post('/api/strategy/manual', summary='保存手动求职策略')
async def api_manual_strategy(payload: dict = Body(...)):
    strategy = _normalize_strategy(payload, source='manual', confirmed=True)
    return save_product_config({
        'mode': 'manual',
        'agent': {'enabled': False},
        'strategy': strategy,
    }, replace_strategy=True)


@app.post('/api/local/analyze-resume', summary='本地解析简历并生成免费专用词库')
async def api_local_analyze_resume(payload: dict = Body(...)):
    resume_id = str(payload.get('resumeId') or '')
    try:
        resume = get_resume_text_local(resume_id)
        analysis = await asyncio.to_thread(
            analyze_local_resume,
            str(resume.get('text') or ''),
            filename=str(resume.get('record', {}).get('name') or ''),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    directions = analysis.get('candidateDirections', [])
    profile = {
        'summary': f"识别到 {len(directions)} 个可能方向，请选择你真正想投递的方向",
        'skills': [],
        'targetRoleHints': [],
        'templateIds': [],
    }
    return {
        'profile': profile,
        'draftStrategy': None,
        'warnings': ['分析结果只是候选方向，在你点击“按这个方向重建词库”之前不会修改当前策略。'],
        'candidateDirections': directions,
        'selectedDirectionId': None,
        'recommendedDirectionId': analysis.get('recommendedDirectionId'),
    }


@app.post('/api/local/build-strategy', summary='按用户选择的方向重建免费专用词库')
async def api_local_build_strategy(payload: dict = Body(...)):
    resume_id = str(payload.get('resumeId') or '')
    direction_id = str(payload.get('directionId') or '')
    if not direction_id:
        raise HTTPException(status_code=400, detail='请选择一个目标岗位方向')
    try:
        resume = get_resume_text_local(resume_id)
        generated = await asyncio.to_thread(
            generate_local_strategy,
            str(resume.get('text') or ''),
            resume_id=resume_id,
            filename=str(resume.get('record', {}).get('name') or ''),
            direction_id=direction_id,
            user_excluded=_split_terms(payload.get('excludedKeywords')),
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    draft = _normalize_strategy(
        generated.get('draftStrategy', {}),
        source='local_resume',
        confirmed=False,
    )
    profile = generated.get('profile') if isinstance(generated.get('profile'), dict) else {}
    save_product_config({
        'mode': 'manual',
        'agent': {'enabled': False},
        'candidateProfile': profile,
        'strategy': draft,
    }, replace_strategy=True)
    return {
        'profile': profile,
        'draftStrategy': draft,
        'warnings': generated.get('warnings', []),
        'candidateDirections': generated.get('candidateDirections', []),
        'selectedDirectionId': generated.get('selectedDirectionId'),
    }


def _resume_text_for_strategy(resume_id: str) -> dict:
    resume = get_resume_for_agent(resume_id)
    if resume.get('kind') == 'text':
        return resume
    # 图片只转录一次，后续重建词表复用本地文字。
    if not re.fullmatch(r'[0-9a-f]{32}', resume_id):
        raise ValueError('简历编号无效')
    cached_path = RESUME_DIR / f'{resume_id}.ocr.txt'
    if cached_path.exists():
        text = cached_path.read_text(encoding='utf-8')
    else:
        text = get_agent().extract_resume_text(resume)
        cached_path.write_text(text, encoding='utf-8')
    return {'kind': 'text', 'text': text, 'record': resume.get('record', {})}


@app.post('/api/agent/analyze-resume', summary='本地解析简历并生成 Agent 模式词表')
async def api_agent_analyze_resume(payload: dict = Body(...)):
    resume_id = str(payload.get('resumeId') or '')
    try:
        resume = await asyncio.to_thread(_resume_text_for_strategy, resume_id)
        text = str(resume.get('text') or '')
        analysis = await asyncio.to_thread(
            analyze_local_resume, text,
            filename=str(resume.get('record', {}).get('name') or ''),
        )
        direction_id = analysis['recommendedDirectionId']
        result = await asyncio.to_thread(
            generate_local_strategy, text,
            resume_id=resume_id,
            filename=str(resume.get('record', {}).get('name') or ''),
            direction_id=direction_id,
        )
    except (ValueError, RuntimeError, AgentConfigurationError, AgentRequestError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    profile = result.get('profile') if isinstance(result.get('profile'), dict) else {}
    questions = _strategy_questions(profile)
    draft = result.get('draftStrategy') if isinstance(result.get('draftStrategy'), dict) else {}
    draft['resumeId'] = resume_id
    draft['directionId'] = direction_id
    draft = _normalize_strategy(draft, source='agent', confirmed=False)
    save_product_config({
        'mode': 'agent',
        'candidateProfile': profile,
        'agentQuestions': questions[:8],
        'strategy': draft,
    }, replace_strategy=True)
    return {
        'profile': profile, 'questions': questions[:8], 'draftStrategy': draft,
        'candidateDirections': analysis['candidateDirections'],
        'recommendedDirectionId': direction_id,
    }


@app.post('/api/agent/build-strategy', summary='根据用户回答重建本地词表')
async def api_agent_build_strategy(payload: dict = Body(...)):
    config = get_product_config(public=False)
    draft = config.get('strategy', {})
    resume_id = str(draft.get('resumeId') or '')
    answers = payload.get('answers', {}) if isinstance(payload.get('answers'), dict) else {}
    try:
        resume = await asyncio.to_thread(_resume_text_for_strategy, resume_id)
        text = str(resume.get('text') or '')
        result = await asyncio.to_thread(
            generate_local_strategy, text,
            resume_id=resume_id,
            filename=str(resume.get('record', {}).get('name') or ''),
            direction_id=str(payload.get('directionId') or draft.get('directionId') or '') or None,
            user_excluded=_answer_terms(answers.get('excludedKeywords')),
            target_roles=_answer_terms(answers.get('targetRoles')) or None,
            preferred_skills=_answer_terms(answers.get('preferredSkills')) or None,
        )
    except (ValueError, RuntimeError, AgentConfigurationError, AgentRequestError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    strategy = dict(result['draftStrategy'])
    strategy['directionId'] = result['selectedDirectionId']
    strategy['ignoredPreferredSkills'] = result['ignoredPreferredSkills']
    strategy = _normalize_strategy(strategy, source='agent', confirmed=False)
    save_product_config({
        'mode': 'agent', 'strategy': strategy, 'candidateProfile': result['profile'],
    }, replace_strategy=True)
    return strategy


@app.post('/api/strategy/confirm', summary='修改并确认当前求职策略')
async def api_confirm_strategy(payload: dict | None = Body(default=None)):
    config = get_product_config(public=False)
    current = dict(config.get('strategy', {}))
    previous = dict(current)
    if isinstance(payload, dict):
        current.update(payload)
    if (current.get('source') or config.get('mode')) == 'agent':
        if isinstance(payload, dict) and 'searchKeywords' in payload and 'targetRoles' not in payload:
            current['targetRoles'] = payload['searchKeywords']
        from agent_service import build_agent_scoring
        current['scoring'] = build_agent_scoring(current, current.get('scoring'), previous)
    strategy = _normalize_strategy(
        current,
        source=current.get('source') or config.get('mode', 'manual'),
        confirmed=True,
    )
    return save_product_config({'strategy': strategy}, replace_strategy=True)


@app.get('/api/dashboard', summary='获取运行概览')
async def api_dashboard():
    decisions = _read_jsonl(LOG_PATH)
    actions = _read_jsonl(ACTION_LOG_PATH)
    today = datetime.now().date().isoformat()
    today_decisions = [item for item in decisions if str(item.get('loggedAt', '')).startswith(today)]
    today_actions = [item for item in actions if str(item.get('loggedAt', '')).startswith(today)]
    strategy = _active_strategy() or {}
    threshold = _int_or_default(strategy.get('threshold'), 80)
    return {
        'scanned': len(today_decisions),
        'recommended': sum(1 for item in today_decisions if int(item.get('score') or 0) >= threshold),
        'greeted': sum(1 for item in today_actions if item.get('action') in {'greet_api_succeeded', 'zhaopin_greeting_sent'}),
        'blocked': sum(1 for item in today_actions if item.get('action') == 'job_company_blocked'),
        'review': sum(1 for item in today_actions if item.get('action') == 'job_requires_review'),
        'failed': sum(1 for item in today_actions if item.get('action') in {'greet_api_failed', 'greet_failed', 'greet_timeout', 'zhaopin_greeting_failed'}),
    }


@app.post('/api/execution/plan', summary='生成平台执行计划')
async def api_execution_plan(payload: dict = Body(...)):
    product_config = get_product_config(public=False)
    strategy = product_config.get('strategy', {}) if product_config.get('strategy', {}).get('confirmed') else {}
    job = payload.get('job') if isinstance(payload.get('job'), dict) else {}
    decision = payload.get('decision') if isinstance(payload.get('decision'), dict) else {}
    platform = str(payload.get('platform') or job.get('platform') or '').lower()
    score = _int_or_default(decision.get('score'), 0)
    threshold = _int_or_default(strategy.get('threshold'), 80)
    delivery_mode = strategy.get('deliveryMode', 'review')
    execution_mode = product_config.get('executionMode', 'test')
    confirmed_by_user = payload.get('confirmedByUser') is True
    company = _clean_company(job.get('company'))
    title = str(job.get('title') or '').strip()
    contact_attempt_state = _zhaopin_contact_attempt_state(company, title) if platform == 'zhaopin' else 'none'
    contact_attempted = contact_attempt_state == 'attempted'
    contact_retry_safe = contact_attempt_state == 'retry_safe'
    planned_actions = []

    if score < threshold:
        planned_actions.append({'type': 'skip', 'label': '低于阈值，跳过'})
    elif not company:
        planned_actions.append({'type': 'manual_review', 'label': '公司未知，人工审核'})
    elif contact_attempted:
        planned_actions.append({'type': 'skip_duplicate', 'label': '曾点击过真实沟通，跳过'})
    elif delivery_mode == 'screen_only':
        planned_actions.append({'type': 'record_only', 'label': '仅记录推荐结果'})
    elif platform == 'zhaopin' and delivery_mode == 'auto':
        planned_actions.append({'type': 'auto_greet', 'label': '自动发送招呼'})
    elif platform == 'zhaopin' and delivery_mode == 'review':
        planned_actions.append({'type': 'confirm_then_greet', 'label': '人工确认后发送招呼'})
    elif delivery_mode == 'review':
        planned_actions.append({'type': 'manual_review', 'label': '进入人工审核'})
    elif platform == 'boss':
        planned_actions.extend([
            {'type': 'send_greeting', 'label': '发送招呼语'},
            {'type': 'send_resume', 'label': '发送平台简历'},
        ])
    elif platform in {'zhaopin', 'job51'}:
        planned_actions.extend([
            {'type': 'apply_job', 'label': '申请职位'},
            {'type': 'select_resume', 'label': '选择平台简历'},
        ])
    else:
        planned_actions.append({'type': 'manual_review', 'label': '未知平台，人工审核'})

    platform_info = next((item for item in list_platforms() if item['id'] == platform), None)
    platform_enabled = bool(product_config.get('platforms', {}).get(platform, {}).get('enabled'))
    manual_confirmation_required = bool(platform_info and platform_info.get('manualConfirmationRequired'))
    requires_user_confirmation = manual_confirmation_required and delivery_mode != 'auto'
    delivery_allows_execute = delivery_mode == 'auto' or (
        platform == 'zhaopin' and delivery_mode == 'review' and confirmed_by_user
    )
    allow_execute = bool(
        execution_mode == 'live'
        and delivery_allows_execute
        and platform_info
        and platform_info.get('implemented')
        and platform_enabled
        and (not requires_user_confirmation or confirmed_by_user)
        and not contact_attempted
        and company
        and score >= threshold
    )
    if execution_mode == 'test':
        blocked_by = 'test_mode'
    elif not platform_info or not platform_info.get('implemented'):
        blocked_by = 'adapter_not_live'
    elif not platform_enabled:
        blocked_by = 'platform_disabled'
    elif delivery_mode == 'screen_only':
        blocked_by = 'screen_only'
    elif not company:
        blocked_by = 'company_missing'
    elif score < threshold:
        blocked_by = 'below_threshold'
    elif contact_attempted:
        blocked_by = 'duplicate_contact_attempt'
    elif requires_user_confirmation and not confirmed_by_user:
        blocked_by = 'user_confirmation_required'
    elif not delivery_allows_execute:
        blocked_by = delivery_mode
    else:
        blocked_by = None
    return {
        'platform': platform,
        'executionMode': execution_mode,
        'deliveryMode': delivery_mode,
        'confirmedByUser': confirmed_by_user,
        'manualConfirmationRequired': requires_user_confirmation,
        'contactAttempted': contact_attempted,
        'contactRetrySafe': contact_retry_safe,
        'allowExecute': allow_execute,
        'blockedBy': blocked_by,
        'plannedActions': planned_actions,
    }


@app.get("/tags", summary="获取职位标签")
async def get_tags():
    return {
        'tags': _effective_client_config()['tags']
    }


@app.get("/get-introduce", summary="获取自我介绍")
async def get_introduce():
    return {
        'introduce': _effective_client_config()['introduce']
    }


@app.get("/client-config", summary="获取前端运行配置")
async def get_client_config():
    return _effective_client_config()


@app.post("/get-job-score", summary="获取职位匹配度")
async def get_job_score(job: Any = Body(..., description="职位信息")):
    raw_job, company, salary, platform = _normalize_job_payload(job)
    product_config = get_product_config(public=False)
    strategy = product_config.get('strategy', {}) if product_config.get('strategy', {}).get('confirmed') else None
    scoring = None
    if strategy:
        scoring = strategy.get('scoring') or build_scoring_from_strategy(strategy)
    result = evaluateSingleRouteDelivery(raw_job, scoring=scoring)
    result['platform'] = platform
    if strategy:
        greeting = str(strategy.get('greeting') or '').strip()
        if greeting:
            result['introduce'] = greeting
        all_text = f"{result.get('title', '')}\n{result.get('detail', '')}".lower()
        excluded = next((
            term for term in _split_terms(strategy.get('excludedKeywords'))
            if term.lower() in all_text
        ), None)
        if excluded:
            result['score'] = 0
            result['final_score'] = 0
            result['matched_field'] = 'strategy_negative'
            result['keyword'] = excluded
            result['reason'] = '命中用户求职策略中的排除条件'
        company_blocked = next((
            term for term in _split_terms(strategy.get('companyBlockKeywords'))
            if company and term.lower() in company.lower()
        ), None)
        if company_blocked:
            result['blocked'] = True
            result['score'] = 0
            result['final_score'] = 0
            result['matched_field'] = 'company_block'
            result['keyword'] = company_blocked
            result['reason'] = '命中用户求职策略中的公司黑名单'

    # 所有平台统一要求公司名称；缺失时可以评分，但绝不允许自动联系。
    if not company:
        result['company_missing'] = True
        result['requires_review'] = True
        result['reason'] = f"{result.get('reason')}；未识别公司名称，已强制转人工审核"

    agent_config = product_config.get('agent', {})
    boundary_min = _int_or_default(agent_config.get('boundaryMin'), 41)
    boundary_max = _int_or_default(agent_config.get('boundaryMax'), 89)
    should_use_agent = bool(
        strategy
        and product_config.get('mode') == 'agent'
        and agent_config.get('enabled')
        and not result.get('blocked')
        and boundary_min <= int(result.get('score') or 0) <= boundary_max
    )
    if should_use_agent:
        job_payload = {
            'title': result.get('title'),
            'company': company,
            'salary': salary,
            'detail': result.get('detail'),
        }
        try:
            agent_result = await asyncio.to_thread(
                get_agent().evaluate_job,
                product_config.get('candidateProfile', {}),
                strategy,
                job_payload,
                result,
            )
            threshold = _int_or_default(strategy.get('threshold'), 80)
            decision = agent_result.get('decision')
            agent_score = int(agent_result.get('score') or 0)
            if decision == 'recommend':
                result['score'] = max(threshold, agent_score)
            elif decision == 'review':
                result['score'] = max(threshold, agent_score)
                result['requires_review'] = True
            else:
                result['score'] = min(max(0, threshold - 1), agent_score)
            result['final_score'] = result['score']
            result['agent_used'] = True
            result['agent_decision'] = decision
            result['agent_confidence'] = agent_result.get('confidence')
            result['agent_reason'] = agent_result.get('reason')
            result['reason'] = f"Agent二次判断：{agent_result.get('reason') or decision}"
        except (AgentConfigurationError, AgentRequestError) as exc:
            result['agent_used'] = False
            result['agent_error'] = str(exc)
            result['reason'] = f"{result.get('reason')}；Agent不可用，已回退规则结果"

    result['decisionId'] = uuid.uuid4().hex
    result['company'] = company
    result['salary'] = salary
    delivery_mode = strategy.get('deliveryMode', 'review') if strategy else 'review'
    execution_mode = product_config.get('executionMode', 'test')
    result['autoSend'] = (
        execution_mode == 'live'
        and delivery_mode == 'auto'
        and not result.get('requires_review', False)
    )
    delay_ms = max(0, Config.job_score_delay_base_ms + random.randint(
        -Config.job_score_delay_jitter_ms,
        Config.job_score_delay_jitter_ms,
    ))
    time_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    title = result['title'] or '未识别标题'
    keyword = result['keyword'] or '无'
    matched_field_map = {
        'title': '岗位名称',
        'detail': '职位描述',
        'none': '未命中',
        'title_negative': '标题负向拦截',
        'strategy_negative': '用户排除条件',
        'company_block': '公司黑名单',
    }
    print(
        f"[{time_str}] /get-job-score | "
        f"title={title} | "
        f"matched={matched_field_map.get(result['matched_field'], result['matched_field'])} | "
        f"keyword={keyword} | "
        f"title_score={result['title_score']} | "
        f"detail_score={result['detail_score']} | "
        f"combo_score={result['combo_score']} | "
        f"title_penalty_score={result.get('title_penalty_score', 0)} | "
        f"penalty_score={result['penalty_score']} | "
        f"delay_ms={delay_ms} | "
        f"score={result['score']} | "
        f"reason={result['reason']}",
        flush=True
    )
    append_job_decision_log(result, raw_job, delay_ms)
    await asyncio.sleep(delay_ms / 1000)
    return {
        'score': result['score'],
        'introduce': result['introduce'],
        'resumeIndex': result['resumeIndex'],
        'decisionId': result['decisionId'],
        'autoSend': result['autoSend'],
        'decisionMode': delivery_mode,
        'executionMode': execution_mode,
        'agentUsed': result.get('agent_used', False),
        'agentDecision': result.get('agent_decision'),
        'reason': result.get('reason'),
        'company': company,
        'companyMissing': result.get('company_missing', False),
    }


@app.post("/log-action", summary="记录前端动作日志")
async def log_action(action: dict = Body(..., description="动作日志")):
    append_job_action_log(action)
    return {'success': True}


@app.post("/reply", summary="回复消息")
async def reply(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return replyMsg(msgs, '', Config.character)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/is-need-resume", summary="是否需要简历")
async def is_need_resume(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return {
            'need': isNeedResume(msgs)
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/is-need-works", summary="是否需要作品集")
async def is_need_works(msgs: list[Msg] = Body(..., description="消息列表")):
    try:
        return {
            'need': isNeedWorks(msgs)
        }
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


if __name__ == '__main__':
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
