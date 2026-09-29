from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any
import keyring

from model_providers import get_provider


class KeyringUnavailableError(RuntimeError):
    pass


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
CONFIG_PATH = DATA_DIR / "product_config.json"
SECRETS_PATH = DATA_DIR / "secrets.json"
RESUME_DIR = DATA_DIR / "resumes"
RESUME_INDEX_PATH = DATA_DIR / "resumes.json"


DEFAULT_PRODUCT_CONFIG: dict[str, Any] = {
    "version": 1,
    "mode": "manual",
    "executionMode": "test",
    "agent": {
        "enabled": False,
        "provider": "bailian",
        "providerName": "阿里云百炼",
        "model": "qwen3.8-flash",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        "boundaryMin": 41,
        "boundaryMax": 89,
        "autoChat": False,
    },
    "strategy": {
        "confirmed": False,
        "source": "manual",
        "searchKeywords": [],
        "excludedKeywords": [],
        "companyBlockKeywords": [],
        "threshold": 80,
        "greeting": "",
        "dailyLimit": 30,
        "deliveryMode": "review",
        "resumeDelivery": "platform_resume",
        "resumeId": None,
        "targetRoles": [],
        "preferredSkills": [],
        "cities": [],
        "jobType": "",
        "minimumSalary": "",
        "scoring": {},
    },
    "candidateProfile": {},
    "agentQuestions": [],
    "platforms": {
        "boss": {"enabled": True},
        "zhaopin": {"enabled": False},
        "job51": {"enabled": False},
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return copy.deepcopy(default)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return copy.deepcopy(default)
    return value


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def get_product_config(*, public: bool = True) -> dict:
    stored = _read_json(CONFIG_PATH, {})
    config = _deep_merge(DEFAULT_PRODUCT_CONFIG, stored if isinstance(stored, dict) else {})
    config['agent'].pop('apiKey', None)
    if config['agent'].get('provider') == 'qwen':
        config['agent']['provider'] = 'bailian'
    if public:
        config["agent"]["hasApiKey"] = bool(get_api_key(config['agent']['provider']))
    return config


def save_product_config(update: dict, *, replace_strategy: bool = False) -> dict:
    current = get_product_config(public=False)
    merged = _deep_merge(current, update)
    # 一份简历对应一套完整策略。生成新策略时必须整体替换，不能把上一份
    # 简历词库中的字典键递归合并进来。
    if replace_strategy and isinstance(update.get("strategy"), dict):
        merged["strategy"] = copy.deepcopy(update["strategy"])
    if replace_strategy and isinstance(update.get("candidateProfile"), dict):
        merged["candidateProfile"] = copy.deepcopy(update["candidateProfile"])
    # 密钥只写入系统密钥库，绝不进入普通配置和 Git。
    agent_update = update.get("agent") if isinstance(update, dict) else None
    provider = merged.get('agent', {}).get('provider', 'bailian')
    if provider == 'qwen':
        provider = 'bailian'
        merged['agent']['provider'] = provider
    get_provider(provider)
    merged['agent']['providerName'] = get_provider(provider).name
    merged['agent']['baseUrl'] = get_provider(provider).chat_url
    if isinstance(agent_update, dict) and "apiKey" in agent_update:
        if str(agent_update.get('apiKey') or '').strip():
            set_api_key(str(agent_update['apiKey']), provider)
    merged.get("agent", {}).pop("apiKey", None)
    merged.get("agent", {}).pop("hasApiKey", None)
    if merged.get("executionMode") not in {"test", "live"}:
        merged["executionMode"] = "test"
    _write_json(CONFIG_PATH, merged)
    return get_product_config(public=True)


def _keyring_call(method: str, provider: str, *args):
    get_provider(provider)
    try:
        return getattr(keyring, method)('resume-agent', provider, *args)
    except Exception as exc:
        raise KeyringUnavailableError('系统密钥库不可用，请解锁登录密钥环后重试') from exc


def get_api_key(provider: str = 'bailian') -> str:
    value = _keyring_call('get_password', provider)
    if provider == 'bailian' and SECRETS_PATH.exists():
        secrets = _read_json(SECRETS_PATH, {})
        legacy = str(secrets.get('qwenApiKey') or '') if isinstance(secrets, dict) else ''
        if legacy and not value:
            _keyring_call('set_password', provider, legacy)
            value = _keyring_call('get_password', provider)
            if value != legacy:
                raise KeyringUnavailableError('密钥迁移未完成，请解锁系统密钥库后重试')
        if legacy and value:
            # 仅当已确认密钥进入系统密钥库，才移除旧明文。
            if len(secrets) == 1:
                SECRETS_PATH.unlink()
            else:
                secrets.pop('qwenApiKey', None)
                _write_json(SECRETS_PATH, secrets)
    return value or ''


def set_api_key(value: str, provider: str = 'bailian') -> None:
    if value.strip():
        _keyring_call('set_password', provider, value.strip())
    else:
        _keyring_call('delete_password', provider)


def list_resumes() -> list[dict]:
    resumes = _read_json(RESUME_INDEX_PATH, [])
    return resumes if isinstance(resumes, list) else []


def save_resume_record(record: dict) -> dict:
    records = [item for item in list_resumes() if item.get("id") != record.get("id")]
    records.append(record)
    _write_json(RESUME_INDEX_PATH, records)
    return record


def delete_resume_record(resume_id: str) -> dict | None:
    records = list_resumes()
    deleted = next((item for item in records if item.get("id") == resume_id), None)
    if not deleted:
        return None
    _write_json(RESUME_INDEX_PATH, [item for item in records if item.get("id") != resume_id])
    return deleted


def get_resume_record(resume_id: str) -> dict | None:
    return next((item for item in list_resumes() if item.get("id") == resume_id), None)
