// AC6 #2892.f22eb452: "A stored file with one byte changed stops the player before `ready`, naming the file, as today. A
// stored file changed so that it would inflate to 1 GiB stops the player the same way, with the page's memory under 64
// MB above where it stood. A planted page that inflates before it checks fails, naming the memory"
//
// The stored file changed is the player's WebAssembly as the bundle stores it (the receipt's player file): it is a file
// the bundle stores compressed, and the one large file of the lab's bundle, so a page that checks before it inflates
// handles nothing else large while it loads (README: Readings).
// asserts, each run a first visit from the server that sends every file as stored (README: A first visit):
//   - the bundle stores the player compressed (its receipt gives the inflated bytes, its stored bytes are gzip and
//     inflate to WebAssembly), and the bundle as written reaches `ready`;
//   - a copy with one byte of the stored player changed doesn't reach `ready` (a notice shows and `ready` stays false
//     for 5 s more) and a notice names the file (its path, its stored or its inflated SHA-256);
//   - a copy whose stored player is a gzip stream that inflates to 1 GiB stops the same way, naming the file, and the
//     page's memory (README: The page's memory) rises under 64,000,000 B above where it stood before the page asked
//     for that file;
//   - the planted page `web_inflates_before_check` (it inflates each stored file whole, then checks it) on the same
//     1 GiB copy of its own bundle fails, and the failure names the memory.
// Wrong programs: the merge base (it stores the player as it is); a page that skips the check (it reaches `ready` or
// never names the file); the planted page above.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL, TIMEOUT, blocked, copyBundle, exportLab, failsNaming, none, useFileTemp, useShow, useTemp, type Exported } from '../172/helpers.ts';
import { AC, BOMB_INFLATED, MEMORY_RISE, gzipBomb, namesFile, playerFile, storedPlayerFailures, visit, type Stored, type Visit } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const kept = useFileTemp();
const INFLATES_FIRST = 'web_inflates_before_check';

let lab: Exported | undefined;
/** The lab exported once for the file, the player stored compressed. */
function theLab(): { lab: Exported; player: Stored } {
  const what = 'the lab exported to the web';
  lab ??= exportLab(shows(FULL), kept(), join(kept(), 'bundle'), what);
  none(storedPlayerFailures(lab.out, lab.receipt, what), 'the bundle stores the player compressed, as the decision says');
  return { lab, player: playerFile(lab.receipt, what) };
}
let bomb: string | undefined;
/** The gzip stream that inflates to 1 GiB, made once for the file. */
async function theBomb(): Promise<string> {
  if (!bomb) {
    const at = join(kept(), 'bomb.gz');
    const bytes = await gzipBomb(at);
    console.log(`${AC[6]} a gzip stream of ${bytes} B that inflates to ${BOMB_INFLATED} B`);
    bomb = at;
  }
  return bomb;
}
/** The page stopped before `ready`, naming the file. */
function stopFailures(v: Visit, f: Stored, what: string): string[] {
  const out: string[] = [];
  if (v.ready) out.push(`${what}: the player reached ready`);
  if (!namesFile(v.notices, f)) out.push(`${what}: no notice names ${f.path} (or ${f.sha256}, or ${f.inflatedSha}); the notices: ${JSON.stringify(v.notices)}`);
  return out;
}
/** The page's memory rose under 64 MB above where it stood; BLOCKED when neither reading was available. */
function memoryFailures(v: Visit, what: string): string[] {
  const m = v.memory!;
  if (!m.asked) return [`${what}: ${m.says}`];
  if (m.rise === null) blocked(`${what}: the page's memory couldn't be read here (${m.says}). Unblock: run where Chrome's DevTools give Runtime.getHeapUsage's backingStorageSize or ps shows Chrome's renderer`);
  return m.rise < MEMORY_RISE ? [] : [`${what}: the page's memory rose ${m.rise} B above where it stood, not under ${MEMORY_RISE} B (${m.says})`];
}

describe(`${AC[6]} a stored file off its name stops the player before it inflates anything`, () => {
  it(`${AC[6]} a stored file with one byte changed stops the player before ready, naming the file; the bundle as written is ready`, async () => {
    const { lab, player } = theLab();
    const whole = await visit(lab.out, 'stored', 'the bundle as written', { mustBeReady: true });
    expect(whole.ready, 'the bundle as written reaches ready').toBe(true);

    const copy = copyBundle(lab.out, join(temp(), 'one-byte'));
    const bytes = Buffer.from(readFileSync(join(copy, player.path)));
    const at = Math.floor(bytes.length / 2);
    bytes[at] = bytes[at]! ^ 0xff;
    writeFileSync(join(copy, player.path), bytes);
    const v = await visit(copy, 'stored', `the bundle with byte ${at} of ${player.path} changed`);
    console.log(`${AC[6]} one byte changed: ready ${v.ready}, notices ${JSON.stringify(v.notices)}`);
    none(stopFailures(v, player, 'one byte changed'), 'a stored file with one byte changed stops the player before ready, naming the file');
  }, TIMEOUT);

  it(`${AC[6]} a stored file changed to inflate to 1 GiB stops the player the same way, the page's memory under 64 MB above where it stood`, async () => {
    const { lab, player } = theLab();
    const copy = copyBundle(lab.out, join(temp(), 'gib'));
    copyFileSync(await theBomb(), join(copy, player.path));
    const v = await visit(copy, 'stored', `the bundle with ${player.path} changed to inflate to 1 GiB`, { watch: player.path });
    console.log(`${AC[6]} 1 GiB: ready ${v.ready}, notices ${JSON.stringify(v.notices)}; memory: ${v.memory?.says ?? 'none'}`);
    none([...stopFailures(v, player, 'changed to inflate to 1 GiB'), ...memoryFailures(v, 'changed to inflate to 1 GiB')], 'the 1 GiB file stops the player before ready, naming the file, with the page\'s memory under 64 MB above where it stood');
  }, TIMEOUT);

  it(`${AC[6]} the planted ${INFLATES_FIRST} fails on the 1 GiB file, naming the memory`, async () => {
    const what = `the lab exported by the planted ${INFLATES_FIRST}`;
    const planted = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), what, INFLATES_FIRST);
    const player = playerFile(planted.receipt, what);
    const copy = copyBundle(planted.out, join(temp(), 'gib'));
    copyFileSync(await theBomb(), join(copy, player.path));
    const v = await visit(copy, 'stored', `${what}, with ${player.path} changed to inflate to 1 GiB`, { watch: player.path });
    const f = [...stopFailures(v, player, `planted ${INFLATES_FIRST}`), ...memoryFailures(v, `planted ${INFLATES_FIRST}`)];
    console.log(`${AC[6]} planted ${INFLATES_FIRST}: ${f.join(' | ') || 'no failure'}`);
    failsNaming(f, 'memory', `the planted ${INFLATES_FIRST}`);
  }, TIMEOUT);
});
