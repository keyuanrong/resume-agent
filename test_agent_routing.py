import json
import unittest
from unittest.mock import patch

import agent_service


class Response:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return json.dumps({'choices': [{'message': {'content': '{"ok": true}'}}]}).encode()


class AgentRoutingTests(unittest.TestCase):
    def test_deepseek_uses_its_own_key_url_and_supported_payload(self):
        config = {'agent': {'provider': 'deepseek', 'model': 'deepseek-chat', 'enabled': True}}
        with patch.object(agent_service, 'get_product_config', return_value=config), \
             patch.object(agent_service, 'get_api_key', return_value='deep-secret') as key, \
             patch.object(agent_service.urllib.request, 'urlopen', return_value=Response()) as open_url:
            result = agent_service.get_agent()._request([{'role': 'user', 'content': 'hello'}])
        key.assert_called_once_with('deepseek')
        request = open_url.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.deepseek.com/chat/completions')
        self.assertEqual(request.get_header('Authorization'), 'Bearer deep-secret')
        self.assertNotIn('enable_thinking', json.loads(request.data))
        self.assertTrue(result['ok'])


if __name__ == '__main__':
    unittest.main()
