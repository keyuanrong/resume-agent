import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import product_store


class FakeKeyring:
    def __init__(self):
        self.values = {}

    def get_password(self, service, username):
        return self.values.get((service, username))

    def set_password(self, service, username, value):
        self.values[(service, username)] = value

    def delete_password(self, service, username):
        self.values.pop((service, username), None)


class KeyringTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'secrets.json'
        self.keyring = FakeKeyring()
        self.patches = [
            patch.object(product_store, 'SECRETS_PATH', self.path),
            patch.object(product_store, 'keyring', self.keyring),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    def test_keys_are_separate_and_never_written_to_file(self):
        product_store.set_api_key('ali-secret', 'bailian')
        product_store.set_api_key('deep-secret', 'deepseek')
        self.assertEqual(product_store.get_api_key('bailian'), 'ali-secret')
        self.assertEqual(product_store.get_api_key('deepseek'), 'deep-secret')
        self.assertFalse(self.path.exists())

    def test_old_key_is_migrated_then_file_removed(self):
        self.path.write_text(json.dumps({'qwenApiKey': 'old-secret'}))
        self.assertEqual(product_store.get_api_key('bailian'), 'old-secret')
        self.assertFalse(self.path.exists())

    def test_failed_migration_retains_legacy_file(self):
        self.path.write_text(json.dumps({'qwenApiKey': 'old-secret'}))
        self.keyring.set_password = lambda *args: (_ for _ in ()).throw(RuntimeError('locked'))
        with self.assertRaises(product_store.KeyringUnavailableError):
            product_store.get_api_key('bailian')
        self.assertTrue(self.path.exists())

    def test_public_config_exposes_only_key_presence(self):
        config_path = Path(self.directory.name) / 'product_config.json'
        with patch.object(product_store, 'CONFIG_PATH', config_path):
            product_store.save_product_config({'agent': {'provider': 'deepseek', 'model': 'deepseek-chat', 'apiKey': 'deep-secret'}})
            public = product_store.get_product_config()
        self.assertTrue(public['agent']['hasApiKey'])
        self.assertNotIn('apiKey', public['agent'])
        self.assertNotIn('deep-secret', config_path.read_text())


if __name__ == '__main__':
    unittest.main()
