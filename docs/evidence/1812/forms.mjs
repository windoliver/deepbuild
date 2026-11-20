// The Nov 13 UI/UX audit's command run (reports/uiux-agentic-audit-2026-11-13.md), on #1812's blind world
// (tests/acceptance/1812/helpers.ts): every `deep` form in a throwaway home whose installer, curl, wget and service
// managers are stand-ins, so nothing reaches this machine's own ~/.deepbuild, launchd or the network. Not part of the change.
//   node forms.mjs <checkout> <fresh|down|live> <out.jsonl>
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, mode, out] = process.argv.slice(2);
const h = await import(pathToFileURL(join(checkout, 'tests/acceptance/1812/helpers.ts')).href);
h.needBuild();

const ASK = 'ask:01ARZ3NDEKTSV4RRFFQ69G5FAV';
const DOC = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
// Forms that can start an agent, reach a forge or the network are left out of the live world.
const OUTWARD = new Set(['start', 'work', 'land', 'race', 'fix', 'join', 'person', 'update', 'install', 'restore', 'backup', 'setup', 'hub', 'off', 'on']);
const forms = (w) => [
  [], ['--help'], ['--version'], ['bogus'], ['stauts'],
  ['status'], ['status', '--json'], ['status', 'nosuch', '--why'], ['status', '--typo'],
  ['inbox'], ['inbox', '--json'], ['inbox', 'answer', ASK, 'yes'], ['inbox', 'answer'], ['inbox', 'undo', ASK], ['inbox', 'save', 'offer:x'], ['inbox', '--typo'],
  ['doctor'], ['doctor', '--json'], ['doctor', '--typo'],
  ['off'], ['on'], ['off', 'now'],
  ['explain'], ['explain', join(w.tmp, 'nosuch')],
  ['run'], ['run', '--result', join(w.tmp, 'nosuch.json')], ['run', 'follow', 'run:nosuch'], ['run', 'follow', '--typo'],
  ['host'], ['host', 'list'], ['host', 'facts', 'nosuch'], ['host', 'changes', 'nosuch'], ['host', 'run', ASK],
  ['hub'], ['hub', 'status'], ['hub', 'stop'], ['hub', 'bogus'],
  ['fix'], ['fix', 'LIN-42'],
  ['land'], ['land', '--repo', w.work], ['land', 'judge', '--repo', w.work, '--json'],
  ['work'], ['work', 'show'], ['work', 'show', '--repo', w.work], ['work', 'pause'], ['work', 'work through #1', '--repo', w.work],
  ['workspace'], ['workspace', 'new', 'topic'], ['workspace', 'diff', 'nosuch'], ['workspace', 'drift', 'nosuch'], ['workspace', 'move', 'nosuch', join(w.tmp, 'ws')],
  ['setup', '--typo'],
  ['mcp', 'bogus'], ['mcp-exec'], ['mcp-exec', 'nosuch'],
  ['env'], ['env', 'up'], ['env', 'up', '--json'], ['env', 'down'], ['env', '--typo'],
  ['lease'], ['lease', '--', 'true'], ['lease', '--', 'nosuchprogram-xyz'],
  ['numbers'], ['numbers', '--json'], ['numbers', 'refresh'], ['numbers', 'baseline'], ['numbers', '--typo'],
  ['show'], ['show', '--doc', DOC, '--document', join(w.tmp, 'nosuch.json')],
  ['export'], ['export', '--document', join(w.tmp, 'nosuch.json'), '--still', '0', '--out', join(w.tmp, 'x.png')],
  ['kinds'], ['kinds', '--dump', join(w.tmp, 'kinds')], ['kinds', '--diff', join(w.tmp, 'a'), join(w.tmp, 'b')],
  ['open'], ['open', 'page/agents'], ['open', '--typo'],
  ['race'], ['race', '1'],
  ['start'], ['start', '--repo', w.work, '--issue', '1', '--agent', 'claude-code', '--prompt', 'x'],
  ['start', 'approve', '--repo', w.work, '--issues', '1', '--agents', 'claude-code', '--at-once', '1', '--plan-share', '10'],
  ['gate'], ['gate', 'rules'], ['gate', 'rules', '--json'],
  ['install'], ['install', join(w.tmp, 'nosuch')],
  ['guard'], ['guard', 'add', join(w.tmp, 'nosuch.json')],
  ['memory'], ['memory', '--json'], ['memory', 'keep', 'nosuch'], ['memory', 'remove', 'nosuch'], ['memory', 'overrule', 'nosuch'], ['memory', '--typo'],
  ['rules'], ['rules', 'sync'], ['rules', 'credit', 'rule:nosuch'], ['rules', 'reach', '--repo', w.work, '--scope', '**'],
  ['session'], ['session', 'rules', 'nosuch'], ['session', 'rules', '--typo'],
  ['undo'], ['undo', 'staged:nosuch'], ['undo', 'sync:nosuch'],
  ['secret'], ['secret', 'list'], ['secret', 'list', '--json'], ['secret', '--typo'],
  ['join'], ['join', 'https://github.com/a/b', '--invite', 'x'],
  ['person'], ['person', 'invite', 'someone', '--address', '127.0.0.1:9'], ['person', 'revoke', 'someone'],
  ['library'], ['library', 'on', 'nosuch'], ['library', 'off', 'nosuch'], ['library', 'rule', 'nosuch', 'MIT'],
  ['pack'], ['pack', 'rule', 'a/b', 'MIT'],
  ['job'], ['job', 'rule', 'tool@1', '1'],
  ['backup'], ['backup', join(w.tmp, 'backup')], ['backup', '--typo'],
  ['restore'], ['restore', join(w.tmp, 'nosuch')],
  ['update'], ['update', '--check'],
  ['debug'], ['debug', 'bundle'],
  ['read'], ['read', 'ev:nosuch'], ['read', 'ev:nosuch', '--json'],
  ['find'], ['find', 'nosuchword'], ['find', 'nosuchword', '--json'],
  ['waiter'],
];

const read = (r, args, w) => {
  const text = `${r.stdout}\n${r.stderr}`;
  const first = (s) => s.split('\n').find((l) => l.trim()) ?? '';
  const sock = join(w.home, '.deepbuild', 'hub.sock');
  let json = false;
  try { const v = JSON.parse(r.stdout); json = typeof v === 'object' && v !== null; } catch { /* words */ }
  return {
    args, code: r.code, timedOut: r.timedOut,
    out: first(r.stdout).slice(0, 400), err: first(r.stderr).slice(0, 400),
    stack: /\n\s+at .+:\d+:\d+\)?/.test(text) || /node:internal/.test(text),
    undef: /\bundefined\b/.test(text), nan: /\bNaN\b/.test(text), object: /\[object Object\]/.test(text),
    errno: /\b(ENOENT|ECONNREFUSED|EACCES|EPIPE|ENOTDIR|EISDIR|ENOTSOCK|EADDRINUSE)\b/.test(text),
    pathTwice: text.split(sock).length > 2 || text.split(join(w.home, '.deepbuild', 'control.token')).length > 2,
    blocked: /^BLOCKED\b/m.test(text), unsupported: /Unsupported command/.test(text),
    silent: r.code === 0 && !r.stdout.trim() && !r.stderr.trim(),
    jsonNoFlag: json && !args.includes('--json'),
    home: w.home, tmp: w.tmp, full: text.slice(0, 3000),
  };
};

writeFileSync(out, '');
const env = { DEEP_UPDATE_URL: 'http://127.0.0.1:9/latest' };
try {
  if (mode === 'fresh') {
    // A home nobody set up: each form gets its own, since the first-run commands change it.
    for (const args of forms(h.world())) {
      const w = h.world();
      const r = await h.deep(w, args, { hub: 'refuses', extra: env, timeoutMs: 90_000 });
      const row = read(r, args, w);
      row.wrote = existsSync(join(w.home, '.deepbuild'));
      row.calls = h.calls(w).length;
      appendFileSync(out, `${JSON.stringify(row)}\n`);
    }
  } else {
    const w = h.world();
    await h.setUp(w);
    if (mode === 'down') await h.stopHubs(w);
    mkdirSync(join(w.tmp, 'a'), { recursive: true });
    for (const args of forms(w)) {
      if (mode === 'live' && OUTWARD.has(args[0])) continue;
      const r = await h.deep(w, args, { hub: mode === 'live' ? 'starts' : 'refuses', extra: env, timeoutMs: 90_000 });
      appendFileSync(out, `${JSON.stringify(read(r, args, w))}\n`);
    }
  }
} finally {
  await h.cleanup();
}
