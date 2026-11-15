// #2365 AC5: "For every transcript in #20's suite and its perf tasks, the parts joined are byte-identical to the one
// copy the merge base stores of the finished file, and a second pass over an unchanged transcript reads none of it."
//
// "The one copy the merge base stores of the finished file" is, at the base (packages/archive/src/index.ts, copy()),
// the whole file decoded as UTF-8 and scrubbed by the store's text scrub with the values held: `scrubText(file,
// { held })`, which #20's suite reads as `redacted(source, held)`. So each transcript's archived copy, read from its
// parts (helpers.ts, expectCopy), must equal that, byte for byte, after every pass.
//
// The transcripts: #20's suite's own kinds of transcript, built with #20's helpers as its tests build them (Claude
// Code, Codex and a new adapter's; one grown from 10 lines to 50; a pasted key; a held value; and, beyond #20, one in
// non-ASCII text); #20's budget sessions (tests/acceptance/20/generate.ts); and the perf tasks' own transcripts
// (benchmarks/archive.mjs `live`, `month` and `backlog`, its generator reproduced below byte for byte, since that
// file runs on import), at their sizes and with their passes.
//
// "Reads none of it": the pass after one that left every transcript current, in the same process, reads no byte
// from any source file (reads.ts instruments Node's file reads). The planted re-reading archive at the end proves
// the instrument sees a read made through each kind of entry point.
import { randomBytes } from 'node:crypto';
import { createReadStream, appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appendSession, linesUpTo, pathOf, session, writeSession } from '../20/generate.ts';
import {
  appendClaude, bytesOf, claudeHome, claudeTranscript, codexTranscript, expectCopy, HOUR, MB, MINUTE, mulberry32, numbered, openArchiveOn,
  openWorld, redacted, removeTemps, T0, tinyTranscript, word, type World,
} from './helpers.ts';
import { watchReads } from './reads.ts';

afterAll(removeTemps);

const AC5 = '#2365 AC5';
interface Src { id: string; path: string; what: string }
const rng = mulberry32(randomBytes(4).readUInt32LE(0));

/** Each source's archived copy equals the base's one copy of the file as it is now. */
async function allIdentical(w: World, sources: readonly Src[], held: readonly string[], when: string): Promise<void> {
  for (const s of sources) {
    await expectCopy(w, s.id, () => bytesOf(redacted(readFileSync(s.path, 'utf8'), held)), `${AC5} ${s.what}, ${when}: the parts joined equal the base's one copy`);
  }
}
/** One more pass over the unchanged sources reads none of them. */
async function readsNone(w: World, pass: () => Promise<void>, sources: readonly Src[]): Promise<void> {
  w.clock.tick(HOUR);
  const watch = await watchReads(sources.map((s) => s.path));
  try {
    await pass();
  } finally {
    watch.stop();
  }
  const read = sources.map((s) => ({ s, bytes: watch.bytes(s.path) })).filter((r) => r.bytes > 0);
  expect(read.map((r) => `${r.s.what} (${r.s.path}): ${r.bytes} bytes by ${[...new Set(watch.reads.filter((x) => x.path === r.s.path).map((x) => x.how))].join(', ')}`),
    `${AC5} a second pass over unchanged transcripts reads none of them`).toEqual([]);
}

// benchmarks/archive.mjs's transcript(seed, size), reproduced byte for byte: the perf tasks' inputs.
function benchTranscript(seed: number, size: number): { id: string; lines: string[] } {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const T = 1_760_013_451_000;
  const words = 'the cart total tax fix test run build page item price user step list order value return error check case const import export function await'.split(' ');
  const text = (n: number) => Array.from({ length: n }, () => words[Math.floor(words.length * r() ** 2)]).join(' ');
  const id = `${seed.toString(16).padStart(8, '0')}-0000-4000-a000-${String(seed).padStart(12, '0')}`;
  const lines: string[] = [];
  for (let bytes = 0, n = 0; bytes < size; n++) {
    const content = n % 3 === 2 ? [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: Array.from({ length: 40 }, () => `  ${text(8)};`).join('\n') }] : text(30);
    const line = JSON.stringify({ parentUuid: n ? `m${n - 1}` : null, type: n % 3 === 1 ? 'assistant' : 'user', message: { role: n % 3 === 1 ? 'assistant' : 'user', content }, uuid: `m${n}`, timestamp: new Date(T + n * 1000).toISOString(), cwd: '/tmp/shop', sessionId: id });
    lines.push(`${line}\n`);
    bytes += line.length + 1;
  }
  return { id, lines };
}
function benchFolder(w: World): string {
  const folder = join(claudeHome(w.env), 'projects', '-tmp-shop');
  mkdirSync(folder, { recursive: true });
  return folder;
}

describe(`${AC5} the parts joined are byte-identical to the base's one copy, and an unchanged transcript is read no more`, () => {
  it(`${AC5} #20's suite's transcripts: Claude Code, Codex and a new adapter's, grown, with a pasted key, a held value and non-ASCII text`, async () => {
    const held = word(rng, 28, 'abcdefghijklmnopqrstuvwxyz');
    const key = `ghp_${word(rng, 36)}`;
    const w = await openWorld();
    try {
      const grown = claudeTranscript(w.env, numbered(1, 10, 'grow'));
      const other = claudeTranscript(w.env, numbered(1, 3, 'second'), { cwd: '/tmp/dh20-work/api' });
      const codex = codexTranscript(w.env, ['codex: fix the checkout total', 'codex: now run the tests']);
      const tiny = tinyTranscript(w.env, ['tiny: rename the cart module']);
      const keyed = claudeTranscript(w.env, [...numbered(1, 2, 'setup'), { uuid: 'm3', role: 'user', text: `here is my GitHub token so you can push: ${key} use it for the deploy` }, { uuid: 'm4', role: 'assistant', text: 'Thanks. I will set up the deploy step now.' }], { cwd: '/tmp/dh20-work/keys' });
      const holding = claudeTranscript(w.env, [...numbered(1, 2, 'setup'), { uuid: 'm3', role: 'user', text: `the staging database password is ${held} so log in with it` }], { cwd: '/tmp/dh20-work/held' });
      const wide = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: 'Prüfe die Kasse 🛒 — 結帳ページの合計が違う، والضريبة أيضا' }, { uuid: 'm2', role: 'assistant', text: 'Ich prüfe es: 合計 = 小計 + 税 ✓' }], { cwd: '/tmp/dh20-work/wide' });
      const sources: Src[] = [
        { id: grown.id, path: grown.path, what: 'a Claude Code session grown from 10 lines to 50' },
        { id: other.id, path: other.path, what: 'a second Claude Code session' },
        { id: codex.id, path: codex.path, what: 'a Codex rollout' },
        { id: tiny.id, path: tiny.path, what: "a new adapter's transcript" },
        { id: keyed.id, path: keyed.path, what: 'a session with a pasted key' },
        { id: holding.id, path: holding.path, what: 'a session with a held value' },
        { id: wide.id, path: wide.path, what: 'a session in non-ASCII text' },
      ];
      const archive = await openArchiveOn(w, { held: [held] });
      await archive.pass();
      await allIdentical(w, sources, [held], 'after the first pass');
      appendClaude(grown, numbered(11, 50, 'grow'));
      appendClaude(keyed, numbered(5, 9, 'later'));
      appendClaude(wide, [{ uuid: 'm3', role: 'user', text: 'Gut — 次は返金ページ 🔁' }]);
      w.clock.tick(HOUR);
      await archive.pass();
      await allIdentical(w, sources, [held], 'after they grew');
      await readsNone(w, () => archive.pass(), sources);
      await allIdentical(w, sources, [held], 'after the pass that read nothing');
    } finally {
      await w.close();
    }
  }, 300_000);

  it(`${AC5} #20's budget sessions (generate.ts): live ones gaining 12 lines a minute, and a heavy day's 5 MB ones at half and whole`, async () => {
    const w = await openWorld();
    try {
      const archive = await openArchiveOn(w);
      const live = Array.from({ length: 3 }, (_, i) => { const g = session(0x20_7000 + i, 3 * MB, T0); const at = linesUpTo(g, MB); writeSession(w.env, g, at); return { g, at }; });
      const day = Array.from({ length: 2 }, (_, s) => { const g = session(0x20_3000 + s, 5 * MB, T0); writeSession(w.env, g, linesUpTo(g, 2.5 * MB)); return g; });
      const sources: Src[] = [...live.map(({ g }) => ({ id: g.id, path: pathOf(w.env, g), what: `live session ${g.id}` })), ...day.map((g) => ({ id: g.id, path: pathOf(w.env, g), what: `day session ${g.id}` }))];
      await archive.pass();
      await allIdentical(w, sources, [], 'at 1 MB and at half');
      for (let minute = 0; minute < 3; minute++) {
        for (const s of live) { appendSession(w.env, s.g, s.at, s.at + 12); s.at += 12; }
        w.clock.tick(MINUTE);
        await archive.pass();
        await allIdentical(w, sources, [], `live minute ${minute + 1}`);
      }
      for (const g of day) writeSession(w.env, g);
      w.clock.tick(6 * HOUR);
      await archive.pass();
      await allIdentical(w, sources, [], 'the day sessions whole');
      await readsNone(w, () => archive.pass(), sources);
    } finally {
      await w.close();
    }
  }, 600_000);

  it(`${AC5} the perf tasks' transcripts (benchmarks/archive.mjs): live, month and backlog, with their passes`, async () => {
    const w = await openWorld();
    try {
      const folder = benchFolder(w);
      const archive = await openArchiveOn(w);
      const pathOf2 = (s: { id: string }) => join(folder, `${s.id}.jsonl`);
      const src = (s: { id: string }, what: string): Src => ({ id: s.id, path: pathOf2(s), what });

      // live: ten sessions 1 MB in, each gaining 12 lines a minute; one pass a minute for five minutes.
      const live = Array.from({ length: 10 }, (_, i) => ({ s: benchTranscript(0x2070 + i, 2 * MB), at: 0 }));
      for (const l of live) {
        for (let bytes = 0; bytes < MB; l.at++) bytes += l.s.lines[l.at]!.length;
        writeFileSync(pathOf2(l.s), l.s.lines.slice(0, l.at).join(''));
      }
      // month: four 5 MB transcripts at half; backlog: twenty 5 MB transcripts whole.
      const month = Array.from({ length: 4 }, (_, i) => benchTranscript(0x2030 + i, 5 * MB));
      for (const s of month) writeFileSync(pathOf2(s), s.lines.slice(0, s.lines.length >> 1).join(''));
      const backlog = Array.from({ length: 20 }, (_, i) => benchTranscript(0x2010 + i, 5 * MB));
      for (const s of backlog) writeFileSync(pathOf2(s), s.lines.join(''));
      const sources = [...live.map((l) => src(l.s, `archive-live ${l.s.id}`)), ...month.map((s) => src(s, `archive-month ${s.id}`)), ...backlog.map((s) => src(s, `archive-backlog ${s.id}`))];

      await archive.pass();
      await allIdentical(w, sources, [], 'after the first pass');
      for (let minute = 0; minute < 5; minute++) {
        for (const l of live) { appendFileSync(pathOf2(l.s), l.s.lines.slice(l.at, l.at + 12).join('')); l.at += 12; }
        w.clock.tick(MINUTE);
        await archive.pass();
      }
      for (const s of month) writeFileSync(pathOf2(s), s.lines.join(''));
      w.clock.tick(6 * HOUR);
      await archive.pass();
      await allIdentical(w, sources, [], 'finished');
      await readsNone(w, () => archive.pass(), sources);
    } finally {
      await w.close();
    }
  }, 1_200_000);

  it(`${AC5} (planted re-reading archive) the read instrument sees a source read through fs/promises' readFile, a read stream and a FileHandle, so "reads none" can fail`, async () => {
    const w = await openWorld();
    try {
      const ts = [0, 1, 2].map((i) => claudeTranscript(w.env, numbered(1, 4, `reread ${i}`), { cwd: `/tmp/dh20-work/reread-${i}` }));
      const real = await openArchiveOn(w);
      await real.pass();
      const rereading = async () => {
        await readFile(ts[0]!.path);
        for await (const chunk of createReadStream(ts[1]!.path)) void chunk;
        const h = await open(ts[2]!.path, 'r');
        try { await h.read(Buffer.alloc(64), 0, 64, 0); } finally { await h.close(); }
        await real.pass();
      };
      const sources = ts.map((t, i) => ({ id: t.id, path: t.path, what: `reread ${i}` }));
      await expect(readsNone(w, rereading, sources), 'the check fails on an archive that reads unchanged sources, naming each').rejects.toThrow(/reread 0[\s\S]*reread 1[\s\S]*reread 2/);
    } finally {
      await w.close();
    }
  }, 120_000);
});
