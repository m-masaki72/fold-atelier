import base64
import binascii
import json
import os
import socket
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / 'dist'
GENERATION_LOCK = threading.Lock()
MODEL = 'gpt-image-2.5-flare'


def generate_image(prompt):
    payload = {
        'model': MODEL,
        'prompt': (
            'Create one beautiful square, full-bleed artwork for a folded paper sculpture. '
            'One coherent image with a clear central subject, visible paper texture and bold readable shapes. '
            'Keep important elements within the middle 80 percent. No text, no border, no mockup, no folds, no grid. '
            'The user requests this scene: ' + prompt
        ),
        'size': '1024x1024',
        'quality': 'medium',
        'output_format': 'png',
        'n': 1,
    }
    request = urllib.request.Request(
        'https://api.openai.com/v1/images/generations',
        data=json.dumps(payload).encode(),
        headers={'Authorization': 'Bearer ' + os.environ['OPENAI_API_KEY'], 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(request, timeout=175) as response:
        result = json.load(response)
    image = result['data'][0]['b64_json']
    decoded = base64.b64decode(image, validate=True)
    if len(decoded) > 20 * 1024 * 1024 or not decoded.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Invalid generated image')
    return image


class FoldHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def allowed(self):
        port = self.server.server_address[1]
        hosts = (f'127.0.0.1:{port}', f'localhost:{port}')
        origin = self.headers.get('Origin')
        return self.headers.get('Host') in hosts and (origin is None or origin in [f'http://{host}' for host in hosts])

    def json_reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == '/api/fold/config':
            if not self.allowed():
                return self.json_reply(403, {'error': 'Local requests only'})
            return self.json_reply(200, {'generationAvailable': bool(os.environ.get('OPENAI_API_KEY')), 'model': MODEL})
        if self.path in ('/', '/index.html'):
            self.path = '/fold.html'
        return super().do_GET()

    def do_POST(self):
        if self.path != '/api/fold/generate':
            return self.json_reply(404, {'error': 'Not found'})
        if not self.allowed():
            return self.json_reply(403, {'error': 'Local requests only'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 10000 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError()
            prompt = payload.get('prompt')
            if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 1200:
                raise ValueError()
        except (ValueError, TypeError):
            return self.json_reply(400, {'error': '描いてほしい景色を1〜1200文字で入力してください。'})
        if not os.environ.get('OPENAI_API_KEY'):
            return self.json_reply(503, {'error': '画像生成は未接続です。サーバーの OPENAI_API_KEY を設定してください。'})
        if not GENERATION_LOCK.acquire(blocking=False):
            return self.json_reply(429, {'error': '別の絵を生成中です。完成するまでお待ちください。'})
        try:
            return self.json_reply(200, {'image': generate_image(prompt.strip())})
        except urllib.error.HTTPError as error:
            messages = {401: '画像生成のAPIキーを確認してください。', 403: '画像生成の利用権限を確認してください。', 429: '画像生成の利用上限に達しています。しばらくしてからお試しください。', 400: 'この内容では画像を生成できませんでした。表現を変えてお試しください。'}
            return self.json_reply(502, {'error': messages.get(error.code, '画像生成サービスでエラーが発生しました。')})
        except (urllib.error.URLError, TimeoutError, socket.timeout):
            return self.json_reply(504, {'error': '画像生成への接続がタイムアウトしました。'})
        except (ValueError, KeyError, IndexError, TypeError, binascii.Error):
            return self.json_reply(502, {'error': '生成した画像を読み取れませんでした。'})
        finally:
            GENERATION_LOCK.release()


if __name__ == '__main__':
    port = int(os.environ.get('FOLD_PORT', '8766'))
    print(f'FOLD: http://127.0.0.1:{port}/fold.html', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), FoldHandler).serve_forever()
