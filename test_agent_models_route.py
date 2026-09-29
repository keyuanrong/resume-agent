import asyncio
import unittest
from unittest.mock import patch

from fastapi import HTTPException
import main


class ModelRouteTests(unittest.TestCase):
    def test_unknown_provider_rejected_before_key_access(self):
        with patch.object(main, 'get_api_key') as key:
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(main.api_agent_models({'provider': 'unknown'}))
        self.assertEqual(caught.exception.status_code, 400)
        key.assert_not_called()

    def test_temporary_key_is_used_only_for_selected_provider(self):
        async def fake_thread(fn, provider, api_key):
            return fn(provider, api_key)
        with patch.object(main, 'get_api_key') as stored_key, \
             patch.object(main.asyncio, 'to_thread', side_effect=fake_thread), \
             patch.object(main, 'list_provider_models', return_value=[{'id':'deepseek-chat', 'name':'deepseek-chat', 'provider':'deepseek'}]) as listing:
            result = asyncio.run(main.api_agent_models({'provider':'deepseek', 'apiKey':'temporary-key'}))
        stored_key.assert_not_called()
        listing.assert_called_once_with('deepseek', 'temporary-key')
        self.assertEqual(result['models'][0]['id'], 'deepseek-chat')


if __name__ == '__main__':
    unittest.main()
