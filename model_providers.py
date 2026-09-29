"""受信任的模型服务商及其公开模型列表。"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass


class ModelDiscoveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    chat_url: str
    models_url: str


PROVIDERS = {
    'bailian': Provider(
        'bailian', '阿里云百炼',
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=100',
    ),
    'deepseek': Provider(
        'deepseek', 'DeepSeek',
        'https://api.deepseek.com/chat/completions',
        'https://api.deepseek.com/models',
    ),
}


def get_provider(provider_id: str) -> Provider:
    try:
        return PROVIDERS[provider_id]
    except KeyError as exc:
        raise ValueError('不支持的模型服务商') from exc


def list_provider_models(provider_id: str, api_key: str) -> list[dict]:
    provider = get_provider(provider_id)
    if not api_key:
        raise ModelDiscoveryError('请先配置此服务商的 API Key')
    request = urllib.request.Request(
        provider.models_url,
        headers={'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as exc:
        raise ModelDiscoveryError(f'获取模型列表失败（HTTP {exc.code}）') from exc
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise ModelDiscoveryError('无法获取模型列表，请检查网络和 API Key') from exc
    try:
        source = body['output']['models'] if provider_id == 'bailian' else body['data']
        if not isinstance(source, list):
            raise TypeError('models is not a list')
        normalized = []
        for item in source:
            model_id = item.get('model') if provider_id == 'bailian' else item.get('id')
            if not isinstance(model_id, str) or not model_id:
                continue
            normalized.append({
                'id': model_id,
                'name': str(item.get('name') or model_id),
                'provider': provider_id,
            })
        return normalized
    except (KeyError, TypeError, AttributeError) as exc:
        raise ModelDiscoveryError('模型列表响应格式不符合预期') from exc
