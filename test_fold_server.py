import base64
import io
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from fold_server import FoldHandler, generate_image, GENERATION_LOCK, MODEL


class QuietHandler(FoldHandler):
    def log_message(self, *args):
        pass


class FoldServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, payload=None, headers=None):
        request = urllib.request.Request(self.url + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers or {'Content-Type': 'application/json'})
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_missing_key_is_explicit(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': ''}):
            status, config = self.request('/api/fold/config')
            self.assertEqual(status, 200)
            self.assertFalse(config['generationAvailable'])
            self.assertEqual(self.request('/api/fold/generate', {'prompt': '青い鯨'})[0], 503)

    def test_invalid_requests_never_reach_generation(self):
        with patch('fold_server.generate_image') as provider:
            for value in ({}, [], {'prompt': ''}, {'prompt': 42}, {'prompt': 'x' * 1201}):
                self.assertEqual(self.request('/api/fold/generate', value)[0], 400)
            self.assertEqual(self.request('/api/fold/generate', {'prompt': 'x'}, {'Content-Type': 'application/json', 'Origin': 'https://example.com'})[0], 403)
            provider.assert_not_called()

    def test_success_and_concurrency(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only'}), patch('fold_server.generate_image', return_value='image-fixture') as provider:
            status, payload = self.request('/api/fold/generate', {'prompt': '  青い鯨  '})
            self.assertEqual((status, payload), (200, {'image': 'image-fixture'}))
            provider.assert_called_once_with('青い鯨')
            GENERATION_LOCK.acquire()
            try:
                self.assertEqual(self.request('/api/fold/generate', {'prompt': 'x'})[0], 429)
            finally:
                GENERATION_LOCK.release()

    def test_provider_failure_releases_lock_and_hides_details(self):
        error = urllib.error.HTTPError('https://api.openai.com', 401, 'private detail', {}, None)
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only'}), patch('fold_server.generate_image', side_effect=error):
            status, payload = self.request('/api/fold/generate', {'prompt': 'x'})
            self.assertEqual(status, 502)
            self.assertNotIn('private detail', json.dumps(payload))
            self.assertFalse(GENERATION_LOCK.locked())

    def test_provider_wire_format(self):
        png = base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
        response = io.BytesIO(json.dumps({'data': [{'b64_json': png}]}).encode())
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only'}), patch('fold_server.urllib.request.urlopen', return_value=response) as open_url:
            self.assertEqual(generate_image('青い鯨'), png)
            request = open_url.call_args.args[0]
            self.assertEqual(request.full_url, 'https://api.openai.com/v1/images/generations')
            body = json.loads(request.data)
            self.assertEqual(body['model'], MODEL)
            self.assertEqual(body['output_format'], 'png')
            self.assertIn('青い鯨', body['prompt'])


if __name__ == '__main__':
    unittest.main()
