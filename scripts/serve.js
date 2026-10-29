'use strict';
// Minimal static server for local testing: node scripts/serve.js [port]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8794);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

// Only this PC by default; HOST=0.0.0.0 to test from a phone on the same network.
const HOST = process.env.HOST || '127.0.0.1';

http.createServer((req, res) => {
  let file;
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath.includes('\0')) throw new Error('bad path');
    file = path.resolve(ROOT, '.' + (urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath));
  } catch (e) {
    res.writeHead(400).end('Bad request'); return;
  }
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, HOST, () => process.stdout.write(`Gpi Shape Check on http://${HOST}:${PORT}\n`));
