import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let url = (req.url || '/').split('?')[0];
  if (url === '/') url = '/index.html';
  if (url === '/about') url = '/about.html';
  const target = path.join(PUBLIC, url);
  if (!target.startsWith(PUBLIC) || !fs.existsSync(target)) {
    res.writeHead(404).end('not found');
    return;
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log(`demo-app listening on http://localhost:${PORT}`);
});
