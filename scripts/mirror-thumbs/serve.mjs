import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '../../web');
const out = path.join(web, 'img/mirror-presets');
const port = Number(process.argv[2]) || 8765;
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/save') {
    const id = url.searchParams.get('id') || '';
    if (!/^[a-z0-9-]+$/.test(id)) { res.writeHead(400).end('bad id'); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `${id}.png`), buf);
      res.writeHead(200).end(String(buf.length));
    });
    return;
  }
  const file = url.pathname === '/capture.html' ? path.join(here, 'capture.html') : path.join(web, path.normalize(url.pathname));
  if (!file.startsWith(web) && !file.startsWith(here)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
}).listen(port, () => console.log(`http://localhost:${port}/capture.html`));
