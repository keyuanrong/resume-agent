from datetime import datetime
import asyncio
import html
import random
import json
import re
import uuid
from pathlib import Path
from typing import Any
from fastapi import FastAPI, Body, HTTPException
from starlette.responses import HTMLResponse
from core import replyMsg, isNeedResume, isNeedWorks, evaluateSingleRouteDelivery
from schema import Msg
from config import Config


app = FastAPI()
LOG_PATH = Path(__file__).resolve().parent / 'job_decisions.jsonl'
ACTION_LOG_PATH = Path(__file__).resolve().parent / 'job_actions.jsonl'


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


def _normalize_job_payload(job: Any) -> tuple[str, str, str]:
    if isinstance(job, dict):
        title = str(job.get('title') or '').strip()
        company = str(job.get('company') or '').strip()
        salary = str(job.get('salary') or '').strip()
        detail = str(job.get('detail') or '').strip()
        raw_job = f'# 职位名称\n{title}\n\n# 薪资范围\n{salary}\n\n# 职位描述\n{detail}'
        return raw_job, company, salary
    raw_job = str(job or '')
    return raw_job, '', _extract_raw_section(raw_job, '薪资范围')


def append_job_decision_log(result: dict, raw_job: str, delay_ms: int):
    log_record = {
        'loggedAt': datetime.now().isoformat(timespec='seconds'),
        'decisionId': result.get('decisionId'),
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
    'greet_queued': '准备沟通',
    'chat_open_requested': '已请求沟通',
    'greet_sent': '已沟通',
    'greet_api_succeeded': '已沟通',
    'greet_api_failed': '沟通失败',
    'greet_queue_failed': '沟通失败',
    'greet_failed': '沟通失败',
    'greet_timeout': '沟通超时',
    'greet_duplicate_blocked': '重复跳过',
}


def build_job_report_rows() -> list[dict]:
    decisions = [
        decision for decision in _read_jsonl(LOG_PATH)
        if decision.get('introduce') != '测试用打招呼语'
    ]
    actions = _read_jsonl(ACTION_LOG_PATH)
    result_by_decision_id = {}
    actions_by_job = {}
    for action in actions:
        result = REPORT_ACTION_RESULTS.get(action.get('action'))
        if not result:
            continue
        decision_id = action.get('decisionId')
        if decision_id:
            result_by_decision_id[decision_id] = result
        key = (action.get('title') or '', action.get('salary') or '')
        actions_by_job.setdefault(key, []).append((action.get('loggedAt') or '', result))

    rows = []
    for decision in decisions:
        raw_job = decision.get('rawJob') or ''
        title = decision.get('title') or _extract_raw_section(raw_job, '职位名称') or '未识别岗位'
        salary = decision.get('salary') or _extract_raw_section(raw_job, '薪资范围') or '未记录'
        company = decision.get('company') or '未记录'
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
            'company': company,
            'title': title,
            'salary': salary,
            'score': decision.get('score'),
            'result': result,
        })

    # 已聊过和详情读取失败的岗位不会进入评分接口，单独补入报告。
    for action in actions:
        if action.get('action') not in {
            'job_already_talked', 'job_skip', 'job_company_blocked', 'job_company_unknown'
        }:
            continue
        rows.append({
            'loggedAt': action.get('loggedAt') or '',
            'company': action.get('company') or '未记录',
            'title': action.get('title') or '未识别岗位',
            'salary': action.get('salary') or '未记录',
            'score': action.get('score'),
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
        f'<td>{html.escape(str(row["company"]))}</td>'
        f'<td>{html.escape(str(row["title"]))}</td>'
        f'<td>{html.escape(str(row["salary"]))}</td>'
        f'<td class="score">{html.escape(str(row["score"] if row["score"] is not None else "-"))}</td>'
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
<div class="table-wrap"><table><thead><tr><th>时间</th><th>公司</th><th>岗位</th><th>薪资</th><th>分数</th><th>结果</th></tr></thead>
<tbody id="rows">{table_rows}</tbody></table></div></div>
<script>document.getElementById('filter').addEventListener('input',function(){{const q=this.value.toLowerCase();document.querySelectorAll('#rows tr').forEach(r=>r.hidden=!r.innerText.toLowerCase().includes(q));}});</script>
</body></html>'''
    return HTMLResponse(page)


@app.get("/tags", summary="获取职位标签")
async def get_tags():
    return {
        'tags': Config.tags
    }


@app.get("/get-introduce", summary="获取自我介绍")
async def get_introduce():
    return {
        'introduce': Config.get_default_introduce()
    }


@app.get("/client-config", summary="获取前端运行配置")
async def get_client_config():
    return Config.get_client_config()


@app.post("/get-job-score", summary="获取职位匹配度")
async def get_job_score(job: Any = Body(..., description="职位信息")):
    raw_job, company, salary = _normalize_job_payload(job)
    result = evaluateSingleRouteDelivery(raw_job)
    result['decisionId'] = uuid.uuid4().hex
    result['company'] = company
    result['salary'] = salary
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
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
