// Scope bullet 1 (#1820): the fetch goes "through the Source block (quota, resume, ...)". Resume: a download cut midway
// continues from the bytes held (a Range request from the offset), is not restarted, and the assembled file is still
// checked against the listed sha256, so a spliced file is refused (AC1's mismatch rule on the resumed path).
// Not tested, undecided at base: the QUOTA. The design gives a Source its quota as calls per minute and per day, set at
// registerSource, and names no field a pack or a test can set for the pack fetch, so no black-box quota refusal can be
// written without inventing a knob; that part of the scope has no acceptance test (see README in this folder).
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CC0 } from '../pack.ts';
import { asks, kinds, newAsks, stored, until, yes } from '../helpers.ts';
import { addAsset, bytes, installOrBlock, LICENSE_TEXT, scopedWorld, sha, writePack, type Listed, type Req, type Scoped } from './world.ts';

const PACK = 'acme/big'; const VERSION = '1.0.0';
const SIZE = 400_000; const CUT = 150_000;
const mk = (path: string): Listed => ({ path, body: bytes(path, SIZE), license: CC0, licenseText: LICENSE_TEXT.cc0 });
const FILES = { cut: mk('b/cut.bin'), spliced: mk('b/spliced.bin') };
let w: Scoped;
beforeAll(async () => {
  w = await scopedWorld();
  addAsset(w.srv, PACK, VERSION, FILES.cut, 'cut', 'honor', CUT);
  addAsset(w.srv, PACK, VERSION, FILES.spliced, 'spliced', 'corrupt', CUT);
  await installOrBlock(w, writePack(join(w.tmp, 'big'), w.srv, PACK, VERSION, Object.entries(FILES).map(([tag, a]) => ({ a, tag }))));
}, 600_000);

/** The judge: a resumed download asks the rest by Range from an offset > 0 (not from 0), and never re-reads the head. */
export function judgeResumed(reqs: Req[], size: number): string[] {
  const failures: string[] = [];
  const ranged = reqs.filter((r) => r.range && Number(/bytes=(\d+)-/.exec(r.range)?.[1]) > 0);
  if (!ranged.length) failures.push(`no request resumed from an offset: ${JSON.stringify(reqs)}`);
  if (reqs.filter((r) => !r.range).length > 1) failures.push(`the download restarted from byte 0 ${reqs.filter((r) => !r.range).length} times`);
  if (reqs.length > 4) failures.push(`${reqs.length} requests for one file of ${size} bytes`);
  return failures;
}

async function fetchAfterYes(a: Listed) {
  const args = { op: 'fetch', pack: `${PACK}@${VERSION}`, asset: a.path };
  const before = (await asks(w)).length;
  let o = await kinds(w, args);
  if (o.value.status === 'held') { const r = await newAsks(w, before, 'authority'); expect(r.length, 'one ask').toBe(1); await yes(w, r[0]!); o = await until(w, args); }
  // A cut may end the job for a retry; retrying must not ask again.
  for (let i = 0; i < 3 && o.value.status !== 'fetched' && !(o.value.status === 'refused'); i++) o = await until(w, args);
  expect((await newAsks(w, before, 'authority')).length, 'the resume asked again').toBe(1);
  return o;
}

describe('#1820 (supplement) resume and the whole-file check', () => {
  it('a download cut midway resumes from the offset, lands by its sha256, and one ask covers it', async () => {
    const from = w.srv.log.length;
    const o = await fetchAfterYes(FILES.cut);
    expect(o.value.status, o.text).toBe('fetched');
    expect(o.value.asset?.sha256).toBe(sha(FILES.cut.body));
    expect(await stored(w, sha(FILES.cut.body))).toBeDefined();
    expect(judgeResumed(w.srv.log.slice(from).filter((r) => r.path.endsWith('b/cut.bin')), SIZE)).toEqual([]);
  }, 600_000);

  it('a resumed download whose rest does not match is refused as a whole, naming the asset, and kept nowhere', async () => {
    const o = await fetchAfterYes(FILES.spliced);
    expect(o.isError || o.value.status === 'refused', o.text).toBe(true);
    expect(o.text).toContain(FILES.spliced.path);
    expect(await stored(w, sha(FILES.spliced.body)), 'a spliced file was kept under the listed hash').toBeUndefined();
    expect(w.srv.log.some((r) => r.path.endsWith('b/spliced.bin') && r.range), 'it never resumed, so the splice was not exercised').toBe(true);
  }, 600_000);

  it('judge self-check (a planted restart-from-zero log fails, a resumed one passes)', () => {
    const get = (range?: string): Req => ({ method: 'GET', path: '/x', ...(range ? { range } : {}) });
    expect(judgeResumed([get(), get('bytes=150000-')], SIZE)).toEqual([]);
    expect(judgeResumed([get(), get()], SIZE).join()).toMatch(/no request resumed/);
  });
});
