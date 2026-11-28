import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { APPROVERS, show, signersIn } from './proof-approvals.mjs';

const USAGE = `node scripts/taste.mjs <command> [--root DIR]: one JSON object on stdout (#3423)
  lane [--rev REV]                                    every taste record: its maker, how it reads, the tags naming it
  verdict --record FILE --now ISO                     what one record gives its criterion
  accept --record FILE --ran-on SHA --commits FILE    whether a reading may stand
  list [--rev REV] [--check FILE]                     the readings put to the owner, by issue
  reopen --repo OWNER/NAME                            reopen the issue of each overruled reading
  week --now ISO                                      calls by a person, readings waiting, defaults taken, by ISO week`;
const PROSE = ['who', 'by', 'delegated', 'how'];
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isRecord = (path) => /(^|\/)(TASTE|taste|taste-call)\.json$/.test(path) && !/^tests\/acceptance\/[^/]+\/(.*\/)?twins\//.test(path);

function run(root, command, args, input) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, input });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const git = (root, args) => run(root, 'git', ['-c', 'core.quotePath=false', ...args]);

function makerOf(record) {
  const m = record.maker;
  if (!isObject(m) || Object.keys(m).length !== 1) return null;
  if (typeof m.person === 'string' && m.person.trim()) return 'person';
  const a = m.agent;
  const named = (v) => v === null || (typeof v === 'string' && v.trim() !== '');
  if (isObject(a) && 'model' in a && 'session' in a && named(a.model) && named(a.session) && (a.inputs === undefined || Array.isArray(a.inputs))) return 'agent';
  return null;
}

function callOf(record) {
  for (const key of ['verdict', 'call', 'said']) if (typeof record[key] === 'string') return /wrong/i.test(record[key]) ? 'wrong' : 'right';
  return null;
}

function hashesOf(value, out = new Set()) {
  if (typeof value === 'string') { if (/^[0-9a-f]{64}$/.test(value)) out.add(value); }
  else if (Array.isArray(value)) for (const v of value) hashesOf(v, out);
  else if (isObject(value)) for (const [k, v] of Object.entries(value)) { if (/^[0-9a-f]{64}$/.test(k)) out.add(k); hashesOf(v, out); }
  return out;
}

function issueOf(path, record) {
  if (typeof record.issue === 'number') return record.issue;
  const m = /^(?:docs\/evidence|tests\/acceptance)\/(\d+)/.exec(path);
  return m ? Number(m[1]) : null;
}

function listRev(root, rev) {
  if (rev) return rev;
  const base = git(root, ['merge-base', 'HEAD', 'origin/main']);
  if (base.ok && base.out.trim()) return base.out.trim();
  if (git(root, ['for-each-ref', 'refs/remotes/']).out.trim()) throw new Error('BLOCKED: no merge base with origin/main, so no approvers list to read');
  return git(root, ['rev-parse', 'HEAD']).out.trim();
}

function present(armor) {
  try {
    const bytes = Buffer.from(armor.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
    let at = 10;
    const take = (buffer = bytes) => { const n = buffer.readUInt32BE(at); const v = buffer.subarray(at + 4, at + 4 + n); at += 4 + n; return v; };
    for (let i = 0; i < 4; i += 1) take();
    const signature = take();
    at = 0;
    const type = take(signature).toString();
    take(signature);
    return /^sk-/.test(type) && at < signature.length && (signature[at] & 0x05) !== 0;
  } catch {
    return false;
  }
}

function signatures(root, paths, rev) {
  const wanted = new Set(paths);
  const byPath = new Map();
  const listing = git(root, ['for-each-ref', '--format=%(refname)%00%(objecttype)%00%(contents)%01', 'refs/tags/deep/approved/']);
  if (!listing.ok) return byPath;
  const listed = signersIn(show(root, rev, APPROVERS)).filter((s) => s.presence);
  const dir = mkdtempSync(join(tmpdir(), 'deep-taste-'));
  try {
    const approvers = join(dir, 'approvers');
    writeFileSync(approvers, listed.map((s) => `${s.line}\n`).join(''));
    for (const row of listing.out.split('\x01\n').filter(Boolean)) {
      const [ref, type, body] = row.replace(/\x01$/, '').split('\0');
      if (type !== 'tag' || ![...wanted].some((p) => body.includes(p))) continue;
      const tag = git(root, ['cat-file', 'tag', ref]).out;
      const at = tag.indexOf('-----BEGIN SSH SIGNATURE-----\n');
      if (at < 0 || !tag.trimEnd().endsWith('-----END SSH SIGNATURE-----')) continue;
      const payload = tag.slice(0, at);
      const message = payload.split('\n\n').slice(1).join('\n\n');
      const object = /^object ([0-9a-f]{40})$/m.exec(payload.split('\n\n')[0])?.[1];
      const named = object ? [...message.matchAll(/^Approves: (.+?)(?: @([0-9a-f]{40}))?\s*$/gm)].map(([, p, sha]) => ({ p, sha: sha ?? object })).filter(({ p }) => wanted.has(p)) : [];
      if (!named.length) continue;
      const sig = join(dir, 'sig');
      writeFileSync(sig, tag.slice(at));
      if (!run(dir, 'ssh-keygen', ['-Y', 'check-novalidate', '-n', 'git', '-s', sig], payload).ok) continue;
      let principal = null;
      if (listed.length) {
        const found = run(dir, 'ssh-keygen', ['-Y', 'find-principals', '-f', approvers, '-s', sig]).out.split('\n')[0]?.trim();
        if (found && run(dir, 'ssh-keygen', ['-Y', 'verify', '-f', approvers, '-I', found, '-n', 'git', '-s', sig], payload).ok && present(tag.slice(at))) principal = found;
      }
      const name = ref.replace(/^refs\/tags\//, '');
      for (const { p, sha } of named) byPath.set(p, [...(byPath.get(p) ?? []), { tag: name, principal, approver: principal !== null, sha }]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return byPath;
}

const said = (record) => JSON.stringify([callOf(record), record.criterion ?? null, [...hashesOf(record)].sort()]);

function approvedAsItReads(root, file, record, signed) {
  return signed.map(({ sha, ...s }) => {
    if (!s.approver) return s;
    let then = null;
    try { then = JSON.parse(show(root, sha, file) ?? 'null'); } catch { then = null; }
    return { ...s, approver: isObject(then) && said(then) === said(record) };
  });
}

function read(file, record, signed) {
  const call = callOf(record);
  const maker = makerOf(record);
  const approver = signed.find((s) => s.approver);
  let readsAs = 'none', whose = null;
  if (call && maker === 'person') { readsAs = 'call'; whose = record.maker.person; }
  else if (call && maker === 'agent') { readsAs = 'call'; whose = approver?.principal ?? 'planted'; }
  const failures = [];
  if (call && maker === null) failures.push({ file, reason: PROSE.some((k) => k in record) || 'maker' in record ? 'maker-in-prose' : 'no-maker' });
  if (call && maker === 'agent' && record.by === 'you' && !approver) failures.push({ file, reason: 'agent-marked-yours', field: 'by' });
  return { entry: { file, issue: issueOf(file, record), criterion: record.criterion ?? null, call, maker, reads_as: readsAs, whose, signed }, failures, record };
}

function readAllRecords(root, rev) {
  const listed = rev ? git(root, ['ls-tree', '-r', '--name-only', '--full-tree', rev]) : git(root, ['ls-files']);
  if (!listed.ok) throw new Error(`cannot list ${rev ?? 'the worktree'}: ${listed.err.trim()}`);
  const paths = listed.out.split('\n').filter((p) => p && isRecord(p)).sort();
  const signed = signatures(root, paths, listRev(root, rev));
  return paths.map((file) => {
    const text = show(root, rev ?? null, file);
    let record;
    try { record = JSON.parse(text); } catch { record = null; }
    if (!isObject(record)) return { entry: { file, issue: null, criterion: null, call: null, maker: null, reads_as: 'none', whose: null, signed: [] }, failures: [{ file, reason: 'no-maker' }], record: {} };
    return read(file, record, approvedAsItReads(root, file, record, signed.get(file) ?? []));
  });
}

function oneRecord(root, file) {
  const record = JSON.parse(readFileSync(resolve(root, file), 'utf8'));
  return read(file, record, approvedAsItReads(root, file, record, signatures(root, [file], listRev(root, null)).get(file) ?? []));
}

const due = (record, now) => typeof record.deadline === 'string' && Date.parse(record.deadline) <= Date.parse(now);

function verdict({ entry, record }, now) {
  const out = { file: entry.file, verdict: 'INCONCLUSIVE', reads_as: entry.reads_as, recommended: null, sent_back: null };
  if (entry.reads_as === 'call') {
    out.verdict = entry.call === 'right' ? 'PASS' : 'FAIL';
    if (entry.call === 'wrong') out.sent_back = { by: 'call', file: entry.file };
  } else if (entry.reads_as === 'reading' && entry.call === 'wrong') {
    out.verdict = 'FAIL';
    out.sent_back = { by: 'reading', file: entry.file };
    console.error(`sent back by a reading: ${entry.file}`);
  } else if (entry.reads_as === 'reading') {
    out.recommended = 'right';
    if (due(record, now)) out.reads_as = 'default';
  }
  return out;
}

function accept(root, { entry, record }, ranOn, commits) {
  const refused = [];
  const agent = entry.maker === 'agent' ? record.maker.agent : null;
  if (!agent) return { accepted: false, refused: [{ reason: 'maker', maker: entry.maker }] };
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${ranOn}^{commit}`]);
  if (!commit.ok) throw new Error(`--ran-on ${ranOn} is not a commit`);
  const reach = git(root, ['rev-list', '--end-of-options', commit.out.trim()]);
  if (!reach.ok) throw new Error(`cannot read the commits ${ranOn} holds: ${reach.err.trim()}`);
  if (!Array.isArray(commits) || commits.some((c) => !/^[0-9a-f]{40}$/.test(c?.sha ?? ''))) throw new Error('--commits must be [{sha: <40 hex>, session}]');
  const reachable = new Set(reach.out.split('\n').filter(Boolean));
  if (!agent.session) refused.push({ reason: 'session', session: null });
  else if (commits.some((c) => c.session === agent.session && reachable.has(c.sha))) refused.push({ reason: 'session', session: agent.session });
  if (!Array.isArray(agent.inputs)) refused.push({ reason: 'input', input: null });
  for (const input of agent.inputs ?? []) if (input !== 'criterion' && input !== 'files') refused.push({ reason: 'input', input });
  for (const r of refused) console.error(`${entry.file}: refused, ${r.reason === 'session' ? (r.session ? `session ${r.session} made a commit the pictures' check ran on` : 'it names no session') : r.input ? `its job was given ${r.input}` : 'it names no inputs'}`);
  return { accepted: refused.length === 0, refused };
}

function listOf(all) {
  const issues = new Map();
  for (const { entry, record } of all) {
    if (entry.reads_as !== 'reading') continue;
    issues.set(entry.issue, [...(issues.get(entry.issue) ?? []), { file: entry.file, criterion: entry.criterion, hashes: [...hashesOf(record)].sort() }]);
  }
  return { issues: [...issues].sort(([a], [b]) => a - b).map(([issue, readings]) => ({ issue, readings })) };
}

function isoWeek(time) {
  const d = new Date(Date.parse(time));
  const day = d.getUTCDay() || 7;
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day));
  const first = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return `${thursday.getUTCFullYear()}-W${String(Math.ceil(((thursday - first) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}

function weeks(all, now) {
  const out = {};
  for (const { entry, record } of all) {
    const time = record.when ?? record.at;
    if (entry.call === null || typeof time !== 'string' || Number.isNaN(Date.parse(time))) continue;
    const key = isoWeek(time);
    out[key] ??= { person: 0, waiting: 0, defaults: 0 };
    if (entry.reads_as === 'call') out[key].person += 1;
    else if (entry.reads_as === 'reading' && entry.call === 'right') out[key][due(record, now) ? 'defaults' : 'waiting'] += 1;
  }
  return { weeks: out };
}

function main(argv) {
  const [command, ...rest] = argv;
  const opt = (name) => { const i = rest.indexOf(`--${name}`); return i < 0 ? null : rest[i + 1]; };
  const need = (name) => { const v = opt(name); if (!v) throw new Error(`${command} needs --${name}`); return v; };
  const root = resolve(opt('root') ?? '.');
  if (opt('now') !== null && Number.isNaN(Date.parse(opt('now')))) throw new Error(`--now ${opt('now')} is not a time`);
  if (command === 'lane') {
    const all = readAllRecords(root, opt('rev'));
    const failures = all.flatMap((r) => r.failures);
    for (const f of failures) console.error(`FAIL ${f.file}: ${f.reason === 'no-maker' ? 'a call with no maker' : f.reason === 'maker-in-prose' ? 'its maker is prose, not a maker field' : `an agent's call marked as yours in \`${f.field}\``}`);
    const calls = all.filter((r) => r.entry.call);
    console.error(`taste lane: ${all.length} records, ${calls.length} calls: ${calls.filter((r) => r.entry.maker === 'person').length} by a person, ${calls.filter((r) => r.entry.maker === 'agent').length} by an agent; ${failures.length} failures`);
    return [{ ok: failures.length === 0, records: all.map((r) => r.entry), failures }, failures.length ? 1 : 0];
  }
  if (command === 'verdict') return [verdict(oneRecord(root, need('record')), need('now')), 0];
  if (command === 'accept') {
    const out = accept(root, oneRecord(root, need('record')), need('ran-on'), JSON.parse(readFileSync(resolve(root, need('commits')), 'utf8')));
    return [out, out.accepted ? 0 : 1];
  }
  if (command === 'list') {
    const listed = listOf(readAllRecords(root, opt('rev')));
    const check = opt('check');
    if (!check) return [listed, 0];
    const held = new Set(JSON.parse(readFileSync(resolve(root, check), 'utf8')).issues?.flatMap((i) => (i.readings ?? []).map((r) => r.file)) ?? []);
    const missing = listed.issues.flatMap((i) => i.readings.map((r) => r.file)).filter((f) => !held.has(f));
    for (const f of missing) console.error(`FAIL the list drops the reading ${f}`);
    return [{ missing }, missing.length ? 1 : 0];
  }
  if (command === 'reopen') {
    const repo = need('repo');
    const reopened = [], failed = [];
    for (const { entry, record } of readAllRecords(root, null)) {
      if (!isObject(record.overrule) || entry.issue === null) continue;
      const who = record.overrule.by?.person ?? 'a person';
      const comment = `${who} overruled the taste reading in ${entry.file} for criterion ${entry.criterion ?? '(none named)'}; reopened to make that criterion's call.`;
      const r = run(root, 'gh', ['issue', 'reopen', String(entry.issue), '--repo', repo, '--comment', comment]);
      if (!r.ok) { console.error(`FAIL gh could not reopen #${entry.issue}: ${r.err.trim()}`); failed.push({ issue: entry.issue, criterion: entry.criterion, file: entry.file }); continue; }
      console.error(`reopened #${entry.issue}: ${entry.criterion}`);
      reopened.push({ issue: entry.issue, criterion: entry.criterion, file: entry.file });
    }
    return [{ reopened, failed }, failed.length ? 1 : 0];
  }
  if (command === 'week') return [weeks(readAllRecords(root, null), need('now')), 0];
  throw new Error(`unknown command ${command ?? '(none)'}\n${USAGE}`);
}

try {
  const [out, code] = main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exitCode = code;
} catch (e) {
  console.error(`taste: ${e.message}`);
  process.exitCode = 2;
}
