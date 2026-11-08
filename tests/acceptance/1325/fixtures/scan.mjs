// AC3's reading of the files a session can read, run as one Bash call of the session, so its reads are the session's,
// inside whatever sandbox the session has. It is given only SHA-256 digests of the gate's secrets, never the secrets,
// and reports where a string with one of those digests sits.
//
//   node scan.mjs <digests file> <root>...
//   digests file: JSON { "digests": { "<sha256 hex>": "<label>" } }, waited for up to 60 s (the test writes it once
//   the session has started, so a credential minted at the start is in it).
//
// Each readable regular file of at most 4 MB under each root (no symlinks followed; /tmp, /private/tmp and $TMPDIR only
// to depth 4) is read as bytes and searched for the shapes a credential can take: an installation token (ghs_ and 36
// letters or digits), a JWT, and every 64-character stretch of base64 (a PEM key's lines, or a key with its line
// breaks dropped), after JSON's \n escapes are read as line breaks. The last line printed is one JSON object.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , digestsFile, ...roots] = process.argv;
const deadline = Date.now() + 60_000;
while (!existsSync(digestsFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
const digests = JSON.parse(readFileSync(digestsFile, 'utf8')).digests;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const shallow = (root) => /^(\/private)?\/tmp\/?$/.test(root) || root.replace(/\/$/, '') === (process.env.TMPDIR ?? '').replace(/\/$/, '');
const found = [];
let files = 0;
let unreadable = 0;
const seen = new Set();

function look(path) {
  let text;
  try { text = readFileSync(path).toString('latin1'); } catch { unreadable++; return; }
  files++;
  const plain = text.replace(/\\n/g, '\n');
  const candidates = new Set([
    ...plain.matchAll(/ghs_[A-Za-z0-9]{36}/g),
    ...plain.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g),
    ...plain.replace(/[\r\n]/g, '').matchAll(/[A-Za-z0-9+/]{64}/g),
    ...plain.matchAll(/[A-Za-z0-9+/]{64}/g),
  ].map((m) => m[0]));
  for (const c of candidates) {
    const label = digests[sha(c)];
    if (label && found.length < 50) found.push({ path, label });
  }
}
function walk(dir, depth, limit) {
  if (depth > limit) return;
  let entries;
  try { entries = readdirSync(dir); } catch { unreadable++; return; }
  for (const name of entries) {
    const path = join(dir, name);
    let st;
    try { st = lstatSync(path); } catch { unreadable++; continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) { if (!seen.has(path)) { seen.add(path); walk(path, depth + 1, limit); } }
    else if (st.isFile() && st.size <= 4 << 20) look(path);
  }
}
for (const root of roots) walk(root, 0, shallow(root) ? 4 : 64);
process.stdout.write(`${JSON.stringify({ scan: { roots, files, unreadable, found } })}\n`);
