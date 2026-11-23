// AC4 #172.1e1f958d: "Budgets, measured in the scheduled budget window on a reference Mac at the merged commit against
// its merge base; the PR says `Part of #172` until that window closes the issue; unmeasured is never PASS: the player is
// under 12 MB compressed without fonts and assets; the lab reaches its first frame in under 3 s in Chrome; and it steps
// and draws the lab at 60 fps at 1080p"
//
// This file is the blind redraft of the criterion's size half only, the one #2892's criterion 3 (#2892.62d3dff4) asks
// for: "#172's size criterion still counts the player's WebAssembly once it is stored compressed. … Its blind redraft
// counts the stored file, and a planted bundle whose player is over the 12 MB fails it." The first draft's other two
// tests (the perf lane's task, the reference Mac's times) stay in ../172/budgets.test.ts.
//
// asserts, on any machine, through the first draft's surfaces (../172/README.md: The surface under test):
//   - the player is found by the receipt, never by a file's first bytes: the file whose stored SHA-256, or whose
//     inflated SHA-256 (`inflated: {bytes, sha256}`, #2892's receipt), is `player.hash`; its bytes, inflated when the
//     receipt marks it stored compressed, are WebAssembly with that file's SHA-256;
//   - the player's bytes compressed are the bytes the bundle stores of it, what a host that sends files as stored sends
//     (#2892: "a bundle weighs the same on any host"): the player file's stored bytes, each script the index page loads
//     as stored (its import map's modules, the page glue, and each script element's `src`, the element's script), and
//     each inline script but the bundle's JSON as written. Fonts, the document's assets, logic programs, levels and the
//     fallback page's files are not the player;
//   - that sum is under 12,000,000 B;
//   - the planted export `web_player_over_12mb` (its player's WebAssembly padded with 13,000,000 seeded pseudo-random
//     bytes before the export stores it) fails the same measure, naming the player file.
// Wrong programs: a measure that finds the player by its first bytes (on a stored bundle it counts the scripts alone,
// so the planted bundle passes it); a player over 12 MB as the bundle stores it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, exportLab, hex64, isObject, none, obj, sha256, useShow, useTemp, type Exported } from '../172/helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
/** "the player is under 12 MB compressed without fonts and assets" (12 MB as the first draft read it). */
const PLAYER_LIMIT = 12_000_000;
const OVER = 'web_player_over_12mb';

const isWasm = (b: Buffer): boolean => b.length >= 8 && b.readUInt32BE(0) === 0x0061736d;
/** A stored file's bytes inflated: gzip by its magic bytes, else Brotli; or why they don't inflate. */
function inflate(b: Buffer): Buffer | string {
  try { return b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b, { maxOutputLength: 2 ** 31 - 1 }) : brotliDecompressSync(b, { maxOutputLength: 2 ** 31 - 1 }); } catch (e) { return (e as Error).message; }
}

interface Counted { bytes: number; player: string; parts: string[]; problems: string[] }
/** The player's bytes compressed, by the receipt and the index page (above). */
function playerBytes(lab: Exported, what: string): Counted {
  const files = lab.receipt.files.map((f) => {
    const inf = f.raw['inflated'];
    return { path: f.path, sha256: f.sha256, inflatedSha: isObject(inf) ? hex64(obj(inf, `${what}: ${f.path}'s inflated`)['sha256'], `${what}: ${f.path}'s inflated.sha256`) : null };
  });
  const out: Counted = { bytes: 0, player: '', parts: [], problems: [] };
  const count = (path: string, how: string): void => {
    const f = files.find((x) => x.path === path);
    const n = readFileSync(join(lab.out, path)).length;
    out.bytes += n;
    out.parts.push(`${path} ${n} B (${how}, as stored${f?.inflatedSha ? ' compressed' : ''})`);
  };
  const player = files.find((f) => f.sha256 === lab.receipt.player.hash || f.inflatedSha === lab.receipt.player.hash);
  if (!player) { out.problems.push(`${what}: the receipt names no file whose stored or inflated SHA-256 is its player's ${lab.receipt.player.hash}`); return out; }
  out.player = player.path;
  const stored = readFileSync(join(lab.out, player.path));
  const bytes = player.inflatedSha ? inflate(stored) : stored;
  if (typeof bytes === 'string') out.problems.push(`${what}: the player ${player.path} is marked stored compressed but doesn't inflate: ${bytes}`);
  else if (!isWasm(bytes)) out.problems.push(`${what}: the player ${player.path}${player.inflatedSha ? ', inflated,' : ''} isn't WebAssembly`);
  else if (sha256(bytes) !== (player.inflatedSha ?? player.sha256)) out.problems.push(`${what}: the player ${player.path} holds bytes hashing to ${sha256(bytes)}, not ${player.inflatedSha ?? player.sha256}`);
  count(player.path, 'the player');
  const html = readFileSync(join(lab.out, 'index.html'), 'utf8');
  const clean = (u: string): string => u.replace(/^\.?\//, '');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? ''; const body = m[2] ?? '';
    const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1];
    const type = /\btype="([^"]+)"/.exec(attrs)?.[1] ?? '';
    if (src) count(clean(src), 'a script the index page loads');
    else if (type === 'importmap') for (const v of Object.values((JSON.parse(body) as { imports?: Record<string, string> }).imports ?? {})) count(clean(v), 'a module the import map names');
    else if (type !== 'application/json' && body.trim()) { const n = Buffer.byteLength(body, 'utf8'); out.bytes += n; out.parts.push(`an inline script ${n} B`); }
  }
  return out;
}
const overFailures = (c: Counted): string[] => (c.bytes < PLAYER_LIMIT ? [] : [`the player is ${c.bytes} B compressed, not under ${PLAYER_LIMIT} B: ${c.parts.join(', ')}`]);

describe(`${AC[4]} (blind redraft, size) the player under 12 MB compressed, counting the WebAssembly as the bundle stores it`, () => {
  it(`${AC[4]} (#2892's AC3 #2892.62d3dff4) the lab's player is under 12 MB compressed without fonts and assets, its WebAssembly counted as the bundle stores it (on any machine)`, () => {
    const what = 'the lab exported to the web';
    const c = playerBytes(exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what), what);
    console.log(`${AC[4]} the player: ${c.bytes} B compressed: ${c.parts.join(', ')}`);
    none(c.problems, 'the receipt names the player, and its file holds it');
    none(overFailures(c), `the player is under ${PLAYER_LIMIT} B compressed`);
  }, TIMEOUT);

  it(`${AC[4]} (#2892's AC3 #2892.62d3dff4) a planted bundle whose player is over 12 MB (${OVER}) fails the measure, naming the player file`, () => {
    const what = `the lab exported by the planted ${OVER}`;
    const c = playerBytes(exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what, OVER), what);
    const f = overFailures(c);
    console.log(`${AC[4]} planted ${OVER}: ${f.join(' | ') || `${c.bytes} B, under the limit`}`);
    none(c.problems, 'the receipt names the planted player, and its file holds it');
    expect(f.length, `the planted ${OVER}'s player fails the 12 MB measure`).toBeGreaterThan(0);
    expect(f[0]!.includes(c.player), `the failure names the player file ${c.player}: ${f[0]}`).toBe(true);
  }, TIMEOUT);
});
