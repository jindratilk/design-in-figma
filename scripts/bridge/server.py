#!/usr/bin/env python3
"""Local bridge between a shell and a Figma browser tab.

The tab runs scripts/bridge/agent.js, which polls this server for a command file and
posts results and exported PNGs back. Nothing leaves the machine: the server listens on
127.0.0.1 only. A request that a browser sends from any page other than figma.com is
refused (403), so no other website can read the work directory or write into it, and a
request for another host name is refused too (DNS rebinding).

One tab per channel: the tab that connected last owns the channel, and an older tab that
still polls it is told to stop (410). Otherwise both would run every command.

  python3 server.py [--port 48765] [--dir ./.figma-bridge]

GET  /agent.js      -> the bridge agent
GET  /poll/<ch>     -> long poll for the next command of a channel (?last=<id line>)
GET  /status        -> which tab (file key) owns which channel, and when it last polled
GET  /figma/<name>  -> a recipe from scripts/figma/
GET  /<path>        -> a file in the work directory (cmd-<channel>.js, data/...)
POST /<name>        -> written to <work directory>/out/<name>
"""
import argparse
import http.server
import json
import os
import re
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
RECIPES = os.path.join(os.path.dirname(HERE), 'figma')

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=int(os.environ.get('FIGMA_BRIDGE_PORT', '48765')))
parser.add_argument('--dir', default=os.environ.get('FIGMA_BRIDGE_DIR', os.path.join(os.getcwd(), '.figma-bridge')))
opts = parser.parse_args()
WORK = os.path.abspath(opts.dir)
os.makedirs(os.path.join(WORK, 'out'), exist_ok=True)
FIGMA = re.compile(r'^https://([a-z0-9-]+\.)?figma\.com$')
HOSTS = (f'127.0.0.1:{opts.port}', f'localhost:{opts.port}')
owners = {}  # channel -> id of the agent (tab) that connected last
seen = {}    # channel -> { 'at': time of the last poll, 'file': Figma file key }


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WORK, **kwargs)

    def allowed(self):
        origin = self.headers.get('Origin')
        return self.headers.get('Host', '') in HOSTS and (origin is None or bool(FIGMA.match(origin)))

    def refuse(self):
        self.send_response(403)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def translate_path(self, path):
        clean = path.split('?', 1)[0].split('#', 1)[0]
        if os.path.basename(clean).startswith('.'):
            return os.path.join(WORK, 'out', '.none')  # dot files are never served
        if clean == '/agent.js':
            return os.path.join(HERE, 'agent.js')
        if clean.startswith('/figma/'):
            return os.path.join(RECIPES, os.path.basename(clean))
        return super().translate_path(path)

    def do_GET(self):
        # Long poll: answer as soon as cmd-<channel>.js starts with a line other than
        # ?last=, or with 204 after 25 s. The tab needs no timer, so the browser's
        # throttling of background tabs does not slow the bridge down.
        if not self.allowed():
            return self.refuse()
        url = urllib.parse.urlparse(self.path)
        if url.path == '/status':
            now = time.time()
            body = json.dumps({'dir': WORK, 'channels': {c: {'file': v['file'], 'idle': round(now - v['at'], 1)} for c, v in seen.items()}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not url.path.startswith('/poll/'):
            return super().do_GET()
        channel = os.path.basename(url.path)
        query = urllib.parse.parse_qs(url.query)
        last = query.get('last', [''])[0]
        agent = query.get('agent', [''])[0]
        if agent and (query.get('start') or channel not in owners):
            owners[channel] = agent
        cmd = os.path.join(WORK, f'cmd-{channel}.js')
        deadline = time.time() + 25
        while time.time() < deadline:
            if owners.get(channel, agent) != agent:
                if agent:  # a newer tab took the channel over: this one stops
                    self.send_response(410)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                time.sleep(0.5)  # a tab with an agent from before channel ownership: never hand it a command
                continue
            seen[channel] = {'at': time.time(), 'file': query.get('file', [''])[0]}
            try:
                with open(cmd, 'rb') as handle:
                    data = handle.read()
                if data.split(b'\n', 1)[0].decode('utf-8', 'replace') != last:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/javascript; charset=utf-8')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
            except FileNotFoundError:
                pass
            time.sleep(0.05)
        self.send_response(204)
        self.end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        origin = self.headers.get('Origin') or ''
        if FIGMA.match(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        if not self.allowed():
            return self.refuse()
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if not self.allowed():
            return self.refuse()
        name = os.path.basename(urllib.parse.unquote(self.path.split('?', 1)[0])).lstrip('.') or 'upload.bin'
        data = self.rfile.read(int(self.headers.get('content-length', 0)))
        tmp = os.path.join(WORK, 'out', '.' + name + '.tmp')
        with open(tmp, 'wb') as handle:
            handle.write(data)
        os.replace(tmp, os.path.join(WORK, 'out', name))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')

    def log_message(self, *args):
        pass


print(f'figma bridge on http://127.0.0.1:{opts.port}, work directory {WORK}', flush=True)
http.server.ThreadingHTTPServer.daemon_threads = True
http.server.ThreadingHTTPServer(('127.0.0.1', opts.port), Handler).serve_forever()
