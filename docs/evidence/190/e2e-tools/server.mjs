// Serves the #190 e2e page on 127.0.0.1:41190: `HEAD_SHA=<commit> node server.mjs <data dir>` (default: this folder).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { arch, hostname, platform } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
// The data folder: the first argument, or this file's folder.
const here = process.argv[2] ? pathToFileURL(`${resolve(process.argv[2])}/`) : new URL('.', import.meta.url);
const read = (f) => readFileSync(new URL(f, here), 'utf8');
const lines = (f) => read(f).trim().split('\n').map((l) => JSON.parse(l));
const web = lines('web-replies.jsonl');
const data = {
  plans: web.slice(1).map((r) => r.request), names: ['maze (grid_path@1)', 'chase (grid_path@1)', 'maze (planted corner-cutter, own fixture)', 'grid_path@1 fixture'],
  app: lines('app-bakes-replies.jsonl'), replies: lines('replies.jsonl'), labels: JSON.parse(read('labels.json')), grids: JSON.parse(read('grids.json')),
  planted: { plain: lines('planted-plain.jsonl')[0], tactics: lines('planted-tactics.jsonl')[0] }, head: process.env.HEAD_SHA, host: `${hostname()} (${platform()} ${arch()})`,
};
createServer((req, res) => {
  const send = (t, b) => { res.writeHead(200, { 'content-type': t, 'cache-control': 'no-store' }); res.end(b); };
  if (req.method === 'POST' && req.url.startsWith('/browser?chromium=')) {
    const name = `browser-replies-chromium-${req.url.split('=')[1].replace(/[^0-9]/g, '') || 'unknown'}.json`;
    // The browser's own replies, saved beside the data so the browser column can be checked later.
    let body = ''; req.setEncoding('utf8'); req.on('data', (c) => { body += c; });
    req.on('end', () => { writeFileSync(new URL(name, here), body); res.end('ok'); }); return;
  }
  if (req.url === '/' || req.url.startsWith('/?')) send('text/html', readFileSync(new URL('page.html', import.meta.url), 'utf8'));
  else if (req.url === '/runner.mjs') send('text/javascript', web[0].source);
  else if (req.url === '/data.json') send('application/json', JSON.stringify(data));
  else { res.writeHead(404); res.end(); }
}).listen(41190, '127.0.0.1', () => console.log('listening 41190'));
