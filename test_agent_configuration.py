"""Agent 服务商选择与密钥保护的行为测试。"""
import json
import unittest
from unittest import mock


class _Response:
    def __init__(self, data):
        self.data = json.dumps(data).encode('utf-8')

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.data


class ModelDiscoveryTests(unittest.TestCase):
    def test_bailian_models_are_normalized(self):
        from model_providers import list_provider_models
        body = {'output': {'models': [
            {'model': 'qwen3.7-flash', 'name': 'Qwen 3.7 Flash', 'provider': 'qwen'},
            {'model': 'qwen3.8-flash', 'name': 'Qwen 3.8 Flash', 'provider': 'qwen'},
        ], 'total': 2}}
        with mock.patch('urllib.request.urlopen', return_value=_Response(body)) as opener:
            models = list_provider_models('bailian', 'secret-key')
        self.assertEqual(models, [
            {'id': 'qwen3.7-flash', 'name': 'Qwen 3.7 Flash', 'provider': 'bailian'},
            {'id': 'qwen3.8-flash', 'name': 'Qwen 3.8 Flash', 'provider': 'bailian'},
        ])
        self.assertEqual(opener.call_args.args[0].full_url, 'https://dashscope.aliyuncs.com/api/v1/models?page_no=1&page_size=100')

    def test_deepseek_models_are_normalized(self):
        from model_providers import list_provider_models
        body = {'object': 'list', 'data': [
            {'id': 'deepseek-flash', 'name': 'DeepSeek Flash', 'owned_by': 'deepseek'},
        ]}
        with mock.patch('urllib.request.urlopen', return_value=_Response(body)) as opener:
            models = list_provider_models('deepseek', 'secret-key')
        self.assertEqual(models, [
            {'id': 'deepseek-flash', 'name': 'DeepSeek Flash', 'provider': 'deepseek'},
        ])
        self.assertEqual(opener.call_args.args[0].full_url, 'https://api.deepseek.com/models')

    def test_unknown_provider_is_rejected_without_network_request(self):
        from model_providers import list_provider_models
        with mock.patch('urllib.request.urlopen') as opener:
            with self.assertRaises(ValueError):
                list_provider_models('unknown', 'secret-key')
        opener.assert_not_called()


if __name__ == '__main__':
    unittest.main()
