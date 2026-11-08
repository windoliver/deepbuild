// A read-only npm registry on loopback, test-side: it serves the archives one release made (release-pack's --out folder:
// manifest.json and the tarballs it lists) and nothing else, so an install that needs any other package fails. It
// stands in for the public registry a clean machine would install from; it is not DeepBuild's rehearsal registry.
//   node registry.mjs <archives dir>
// Prints `registry http://127.0.0.1:<port>/` once listening, then one `GET <path> <status>` line per request on stderr.
// Runs until killed (the test stops it by its PID). Works on the host and inside the Linux container alike.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { process.stderr.write('usage: registry.mjs <archives dir>\n'); process.exit(2); }
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const files = new Map();
const packages = new Map();
for (const a of manifest.archives) {
  const path = join(dir, a.file);
  const bytes = readFileSync(path);
  const meta = JSON.parse(execFileSync('tar', ['-xzOf', path, 'package/package.json'], { encoding: 'utf8' }));
  files.set(a.file, bytes);
  const entry = packages.get(meta.name) ?? { versions: {} };
  entry.versions[meta.version] = { meta, file: a.file, bytes };
  packages.set(meta.name, entry);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const send = (status, body, type = 'application/json') => {
    process.stderr.write(`${req.method} ${url.pathname} ${status}\n`);
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, '{"error":"read-only"}');
  if (url.pathname.startsWith('/-/')) {
    const bytes = files.get(decodeURIComponent(url.pathname.slice(3)));
    return bytes ? send(200, bytes, 'application/octet-stream') : send(404, '{"error":"not found"}');
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  const entry = packages.get(name);
  if (!entry) return send(404, '{"error":"not found"}');
  const base = `http://127.0.0.1:${server.address().port}`;
  const versions = {};
  for (const [v, { meta, file, bytes }] of Object.entries(entry.versions)) {
    versions[v] = {
      ...meta,
      _id: `${name}@${v}`,
      dist: {
        tarball: `${base}/-/${encodeURIComponent(file)}`,
        shasum: createHash('sha1').update(bytes).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      },
    };
  }
  const latest = Object.keys(versions).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
  send(200, JSON.stringify({ name, 'dist-tags': { latest }, versions }));
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`registry http://127.0.0.1:${server.address().port}/\n`));
