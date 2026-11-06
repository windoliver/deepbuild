// The work a check of kind service, data, document or message does (#68), in a process of its own so the runner's
// deadline can end it whatever it waits on. It reads {kind, spec, checkout} as JSON on stdin and writes one line of
// JSON: {outcome, testsRun, failures, read}. A failure at the check's assertion is the work not holding; anything
// that stops the work itself (an error, a source that isn't JSON, a mailbox that isn't a Maildir) leaves this
// process with its error on stderr, which the runner keeps as the crash's output.
import { request } from 'node:http';
import { request as requestTls } from 'node:https';
import { isIPv4 } from 'node:net';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const input = JSON.parse(readFileSync(0, 'utf8'));
const { kind, spec, checkout } = input;
const failures = [];
const read = [];
const at = (test, file, line, message) => failures.push({ test, file, line, stack: null, assertion: true, message });
const done = (testsRun, outcome) => {
  process.stdout.write(`${JSON.stringify({ outcome: outcome ?? (failures.length ? 'failed' : 'passed'), testsRun, failures, read })}\n`);
};
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// ---- Service: GET requests leaving from the users' address, each timed; the shape, the p95 and the rate held.

function get(url, from) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const send = u.protocol === 'https:' ? requestTls : request;
    const started = performance.now();
    const req = send(u, { method: 'GET', localAddress: from, family: isIPv4(from) ? 4 : 6, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, ms: performance.now() - started }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function service() {
  // No request sent shows nothing about the endpoint: the run ran nothing, never a pass.
  if (!(Number.isInteger(spec.requests) && spec.requests > 0)) return done(0, 'ran_nothing');
  const answers = [];
  const started = performance.now();
  for (let i = 0; i < spec.requests; i++) {
    try {
      answers.push(await get(spec.url, spec.from));
    } catch (error) {
      // An address this machine doesn't hold: the check can't run from where the users are.
      if (error.code === 'EADDRNOTAVAIL') {
        failures.push({ test: 'service: from', file: spec.url, line: 1, stack: null, assertion: false, message: `the check runs from ${spec.from}, where the endpoint's users are, and this machine holds no such address` });
        return done(0, 'missing');
      }
      throw error;
    }
  }
  const seconds = (performance.now() - started) / 1000;
  const shapes = [];
  for (const a of answers) {
    let body;
    try { body = JSON.parse(a.body); } catch { shapes.push(`answered ${a.status} with a body that isn't JSON`); continue; }
    if (a.status < 200 || a.status > 299) shapes.push(`answered ${a.status}`);
    for (const [field, type] of Object.entries(spec.shape)) {
      if (typeof body !== 'object' || body === null || !(field in body)) shapes.push(`the answer lacks ${field}`);
      else if (typeOf(body[field]) !== type) shapes.push(`${field} is ${typeOf(body[field])}, not ${type}`);
    }
  }
  if (shapes.length) at('service: shape', spec.url, 1, `shape: ${[...new Set(shapes)].join('; ')}`);
  const times = answers.map((a) => a.ms).sort((x, y) => x - y);
  const p95 = times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? 0;
  if (p95 > spec.floor.latency_ms) at('service: latency', spec.url, 1, `latency: the answers' p95 from ${spec.from} is ${Math.round(p95)} ms, over the ${spec.floor.latency_ms} ms floor`);
  const rate = answers.length / seconds;
  if (rate < spec.floor.throughput_rps) at('service: throughput', spec.url, 1, `throughput: ${rate.toFixed(1)} requests answered a second from ${spec.from}, under the ${spec.floor.throughput_rps} floor`);
  done(3);
}

// ---- Data: the query's rows, in order, column for column.

function data() {
  read.push(spec.database);
  const db = new DatabaseSync(join(checkout, spec.database), { readOnly: true });
  const rows = db.prepare(spec.query).all();
  db.close();
  const show = (r) => JSON.stringify(r);
  if (rows.length !== spec.rows.length) at('data: rows', spec.database, 1, `the query returned ${rows.length} rows, not ${spec.rows.length}: ${rows.map(show).join(', ')}`);
  for (let i = 0; i < Math.min(rows.length, spec.rows.length); i++) {
    const want = spec.rows[i];
    const got = rows[i];
    const columns = [...new Set([...Object.keys(want), ...Object.keys(got)])];
    const off = columns.filter((c) => !(c in want) || !(c in got) || (typeof got[c] === 'bigint' ? Number(got[c]) : got[c]) !== want[c]);
    if (off.length) at('data: rows', spec.database, 1, `row ${i + 1} is ${show(got)}, not ${show(want)}: ${off.join(', ')} differ`);
  }
  done(1);
}

// ---- Document: every claim cites a source, and every number in it matches what its next citation points at.

const CITE = /\[[^\]]*\]\(([^)#\s]+\.json)#([^)\s]*)\)/g;
const NUMBER = /(?<![\w.,-])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w,])|(?<![\w.,-])-?\d+(?:\.\d+)?(?![\w,])/g;

function pointed(doc, pointer) {
  let v = doc;
  for (const raw of pointer.split('/').slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof v !== 'object' || v === null || !(key in v)) return undefined;
    v = v[key];
  }
  return v;
}

function document() {
  read.push(spec.document);
  const lines = readFileSync(join(checkout, spec.document), 'utf8').split(/\r?\n/);
  const sources = new Map();
  const source = (path) => {
    if (!sources.has(path)) {
      read.push(path);
      sources.set(path, JSON.parse(readFileSync(join(checkout, path), 'utf8')));
    }
    return sources.get(path);
  };
  // Paragraphs of body text, each character's line kept; headings and fenced code aren't claims.
  const paragraphs = [];
  let text = '';
  let lineOf = [];
  let fenced = false;
  const flush = () => { if (text.trim()) paragraphs.push({ text, lineOf }); text = ''; lineOf = []; };
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; flush(); return; }
    if (fenced || !l.trim() || /^\s*#/.test(l)) { flush(); return; }
    const piece = `${text ? ' ' : ''}${l.trim()}`;
    text += piece;
    lineOf.push(...Array.from(piece, () => i + 1));
  });
  flush();
  let claims = 0;
  for (const p of paragraphs) {
    // A sentence ends at a stop before a space or the paragraph's end, so a decimal point or a file name doesn't end it.
    for (const m of p.text.matchAll(/(?:[^.!?]|[.!?](?=\S))+(?:[.!?]+|$)/g)) {
      const claim = m[0];
      if (!claim.trim()) continue;
      claims++;
      const base = m.index + claim.search(/\S/);
      const line = p.lineOf[base] ?? 1;
      const cites = [...claim.matchAll(CITE)].map((c) => ({ at: c.index, end: c.index + c[0].length, path: c[1], pointer: c[2] }));
      if (!cites.length) { at('document: cited', spec.document, line, `line ${line}: the claim "${claim.trim()}" cites no source`); continue; }
      // A citation cites only what is there: a file that exists, and a pointer that names something in it.
      const cited = new Set();
      for (const c of cites) {
        const where = `${c.path}#${c.pointer}`;
        if (cited.has(where)) continue;
        cited.add(where);
        try { statSync(join(checkout, c.path)); } catch { at('document: cited', spec.document, line, `line ${line}: the claim "${claim.trim()}" cites ${where}, and ${c.path} isn't there`); continue; }
        if (pointed(source(c.path), c.pointer) === undefined) at('document: cited', spec.document, line, `line ${line}: the claim "${claim.trim()}" cites ${where}, which names nothing in ${c.path}`);
      }
      const outside = (i) => !cites.some((c) => i >= c.at && i < c.end);
      for (const n of claim.matchAll(NUMBER)) {
        if (!outside(n.index)) continue;
        const nline = p.lineOf[m.index + n.index] ?? line;
        const cite = cites.find((c) => c.at > n.index) ?? cites.at(-1);
        const where = `${cite.path}#${cite.pointer}`;
        let doc;
        try { statSync(join(checkout, cite.path)); } catch { at('document: numbers', spec.document, nline, `line ${nline}: ${n[0]} cites ${where}, and ${cite.path} isn't there`); continue; }
        doc = source(cite.path);
        const value = pointed(doc, cite.pointer);
        const written = Number(n[0].replace(/,/g, ''));
        if (typeof value !== 'number') at('document: numbers', spec.document, nline, `line ${nline}: ${n[0]} cites ${where}, which holds no number`);
        else if (value !== written) at('document: numbers', spec.document, nline, `line ${nline}: ${n[0]} doesn't match its source ${where}, which holds ${value}`);
      }
    }
  }
  done(claims, claims ? undefined : 'ran_nothing');
}

// ---- Message: delivered to the Maildir, and acknowledged by its seen flag.

function message() {
  const box = join(checkout, spec.mailbox);
  for (const sub of ['new', 'cur']) if (!statSync(join(box, sub)).isDirectory()) throw new Error(`${spec.mailbox} isn't a Maildir: ${sub} isn't a folder`);
  const id = spec.message_id.trim();
  const found = [];
  for (const sub of ['new', 'cur']) {
    for (const name of readdirSync(join(box, sub)).sort()) {
      const rel = `${spec.mailbox}/${sub}/${name}`;
      read.push(rel);
      const head = readFileSync(join(box, sub, name), 'utf8').split(/\r?\n\r?\n/)[0];
      const header = head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).find((h) => /^message-id:/i.test(h));
      if (header && header.slice(header.indexOf(':') + 1).trim() === id) found.push({ sub, name, rel });
    }
  }
  if (!found.length) at('message: delivered', spec.mailbox, 1, `not delivered: no message in ${spec.mailbox}'s new or cur has Message-ID ${id}`);
  else if (!found.some((f) => f.sub === 'cur' && /:2,[A-Z]*S/.test(f.name))) at('message: acknowledged', spec.mailbox, 1, `delivered as ${found[0].rel} and not acknowledged: the mailbox never marked it seen`);
  done(1);
}

const run = { service, data, document, message }[kind];
if (!run) throw new Error(`no such kind: ${kind}`);
await run();
