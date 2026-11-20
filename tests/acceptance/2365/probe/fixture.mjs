// A long Claude Code session's transcript for #2365, written a line at a time so this process never holds it:
// turns of four lines (a typed prompt, a Read call, its tool result, an answer), the answer sized so tool results are
// 94% of the bytes, and turn 50's tool result one line of 2 MB. Seeded: every run, and both sides of a comparison
// with the merge base, write the same bytes. Synthetic text only: made-up identifiers and English words.
//
//   node fixture.mjs write  <path> <bytes> [seed]   writes whole turns until the file reaches <bytes>
//   node fixture.mjs append <path> <bytes>          goes on from where it stopped, for at least <bytes> more
//
// The session ID is the file's name without .jsonl, as Claude Code names it. Each message's uuid is m<n>, n its line,
// so `session:<id>#m<n>` names line n. Beside the file, <path>.meta.json says how far it got: turns, lines, bytes, tool
// result bytes, the longest line, and the last message's uuid and text.
import { closeSync, existsSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LONG_TURN = 50;
export const LONG_BYTES = 2_000_000;
const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const CWD = '/tmp/dh2365-work/long-session';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ENGLISH = 'the a to of and in is it that for on with as this be are we by not or from at can will an all have if more one has run test fix add file use when then make new check case value return error each order cart page total tax item price user step list build next done'.split(' ');
const SYL = ['ca', 'ro', 'ti', 'mo', 'ne', 'la', 'vi', 'su', 'pe', 'da', 'ko', 'ri', 'ba', 'te', 'lo', 'mi', 'zu', 'fa', 'go', 'he'];
const VOCAB = (() => {
  const r = mulberry32(2365);
  const words = new Set(ENGLISH);
  while (words.size < 2000) {
    let w = '';
    for (let i = 2 + Math.floor(r() * 3); i > 0; i--) w += SYL[Math.floor(r() * SYL.length)];
    words.add(w);
  }
  return [...words];
})();
const pick = (r) => VOCAB[Math.min(VOCAB.length - 1, Math.floor(VOCAB.length * r() ** 3))];
const sentence = (r, n) => Array.from({ length: n }, () => pick(r)).join(' ');
/** About `size` characters of a source file as Read shows it: numbered code lines. */
function fileBody(r, size) {
  const out = [];
  let n = 0;
  let len = 0;
  while (len < size) {
    const f = pick(r);
    const code = [`export function ${f}(${pick(r)}, ${pick(r)}) {`, `  const ${pick(r)} = ${pick(r)}.${pick(r)}(${Math.floor(r() * 100)});`, `  if (${pick(r)} > ${pick(r)}) return ${pick(r)};`, '}'][Math.floor(r() * 4)];
    const line = `${String(++n).padStart(6)}\t${code}`;
    out.push(line);
    len += line.length + 1;
  }
  return out.join('\n');
}

/** Turn `t`'s four lines: a pure function of the seed and t, so append goes on exactly where write stopped. */
export function turn(seed, t, id) {
  const r = mulberry32((seed * 1_000_003 + t * 7919) >>> 0);
  const n = 4 * t;
  const at = (k) => new Date(T0 + (n + k) * 1000).toISOString();
  const base = (k, type, message, extra = {}) => ({ parentUuid: n + k ? `m${n + k}` : null, isSidechain: false, userType: 'external', cwd: CWD, sessionId: id, version: '2.1.304', gitBranch: 'main', type, message, uuid: `m${n + k + 1}`, timestamp: at(k), ...extra });
  const tool = `toolu_01${t.toString(16).padStart(22, '0')}`;
  const file = `${CWD}/src/${pick(r)}-${t % 40}.ts`;
  const prompt = JSON.stringify(base(0, 'user', { role: 'user', content: sentence(r, 10 + Math.floor(r() * 30)) }, { promptSource: 'typed' }));
  const call = JSON.stringify(base(1, 'assistant', { model: 'claude-opus-5-5', id: `msg_01${t.toString(16).padStart(22, '0')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: tool, name: 'Read', input: { file_path: file } }], stop_reason: 'tool_use', usage: { input_tokens: 12, output_tokens: 40 } }));
  const size = t === LONG_TURN ? LONG_BYTES : 20_000 + Math.floor(r() * 40_000);
  const result = JSON.stringify(base(2, 'user', { role: 'user', content: [{ tool_use_id: tool, type: 'tool_result', content: fileBody(r, size) }] }, { toolUseResult: { type: 'text', file: { filePath: file } } }));
  // The answer: sized so this turn's tool result is 94% of its bytes.
  const answer = (text) => JSON.stringify(base(3, 'assistant', { model: 'claude-opus-5-5', id: `msg_02${t.toString(16).padStart(22, '0')}`, type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 400 } }));
  const want = Math.round(((result.length + 1) * 6) / 94) - (prompt.length + 1) - (call.length + 1) - (answer('').length + 1);
  let text = sentence(r, 20);
  while (text.length < want) text += ` ${sentence(r, 40)}`;
  text = text.slice(0, Math.max(20, want)).trimEnd();
  return { lines: [prompt, call, result, answer(text)], toolBytes: result.length + 1, last: { uuid: `m${n + 4}`, text } };
}

function run(path, meta, target, append) {
  const fd = openSync(path, append ? 'a' : 'w');
  let added = 0;
  try {
    while (added < target) {
      const { lines, toolBytes, last } = turn(meta.seed, meta.turns, meta.session);
      const chunk = lines.map((l) => `${l}\n`).join('');
      writeSync(fd, chunk);
      added += chunk.length;
      meta.bytes += chunk.length;
      meta.toolBytes += toolBytes;
      meta.lines += 4;
      meta.turns++;
      meta.longest = Math.max(meta.longest, ...lines.map((l) => l.length + 1));
      meta.last = last;
    }
  } finally {
    closeSync(fd);
  }
  meta.toolShare = meta.toolBytes / meta.bytes;
  writeFileSync(`${path}.meta.json`, JSON.stringify(meta, null, 2));
  return meta;
}

export function write(path, bytes, seed = 2365) {
  return run(path, { seed, session: basename(path, '.jsonl'), turns: 0, lines: 0, bytes: 0, toolBytes: 0, longest: 0, last: null }, bytes, false);
}
export function append(path, bytes) {
  if (!existsSync(`${path}.meta.json`)) throw Error(`no ${path}.meta.json: write the fixture first`);
  return run(path, JSON.parse(readFileSync(`${path}.meta.json`, 'utf8')), bytes, true);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, path, bytes, seed] = process.argv.slice(2);
  const meta = cmd === 'write' ? write(path, Number(bytes), seed ? Number(seed) : undefined) : cmd === 'append' ? append(path, Number(bytes)) : null;
  if (!meta) { console.error('usage: node fixture.mjs write|append <path> <bytes> [seed]'); process.exit(2); }
  console.log(JSON.stringify(meta));
}
