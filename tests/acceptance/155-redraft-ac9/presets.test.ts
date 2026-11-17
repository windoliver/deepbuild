// AC9 #155.eaff7d6a: "Every foley@1 preset is a synth.preset@1 entry that passes synth's pack check, and a planted foley
// preset with a node outside the closed list is refused at pack check, naming the preset and the node"
//
// Through `deep-show run` (#393's scenario line on stdin, one answer line out): the first-party pack
// `packs/foley-1.0.0/pack.json` installed with #306's `{call: "install_pack", id: "deepbuild/foley", dir}`, which runs
// synth's pack check (Synth `synth@1`, As built (#204): "Pack check", refusing at `presets/<name>@<major>`), and
// `{call: "registries"}` (`deep://registries/<core version>`), read as #204's suite reads it. The planted preset is the
// pack's own `metal.scrape@1` with one node of a kind outside the closed list put after its output, written in this file
// into a copy of the pack; its clean twin is the same copy with that node a `gain` of 1, which must install, so the
// planted pack is valid but for the planted node and a refusal can only be the planted node's.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const AC9 = 'AC9 #155.eaff7d6a';
const TIMEOUT = 3_600_000;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PACK_DIR = join(REPO, 'packs', 'foley-1.0.0');
const PACK_ID = 'deepbuild/foley';

/** The issue's materials and actions (Foley `foley.render@1`, Fields). */
const MATERIALS = ['paper', 'wood', 'metal', 'glass', 'plastic', 'rubber', 'ink', 'cloth', 'stone', 'electronic'] as const;
const ACTIONS = ['tap', 'hit', 'scrape', 'slide', 'whoosh', 'pop', 'tear', 'drip', 'click'] as const;
/** Synth's closed node list as built (Synth `synth@1`, As built (#204): "the list is the eleven nodes in Fields"). */
const NODES = new Set(['osc', 'noise', 'modes', 'string', 'env', 'biquad', 'shaper', 'crush', 'delay', 'gain', 'mix']);
/** The preset the plant goes into, and the node planted (ID `grains`, of a kind no list holds). */
const PLANTED_PRESET = 'metal.scrape@1';
const PLANTED_NODE = { id: 'grains', kind: 'granular' };

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Obj = { [k: string]: Json };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The binary, built once for this file and copied out of the target folder; temp folders under /tmp/dh155r-*.

const made: string[] = [];
const temp = (): string => { const d = mkdtempSync('/tmp/dh155r-'); made.push(d); return d; };
let binDir = '';
let buildError = '';
beforeAll(() => {
  binDir = mkdtempSync('/tmp/dh155r-bin-');
  const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) buildError = `cargo could not run: ${run.error.message}`;
  else if (run.status !== 0) buildError = `cargo build --locked --bin deep-show failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
  else copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', 'deep-show'), join(binDir, 'deep-show'));
}, TIMEOUT);
afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); });
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** One `deep-show run` scenario: exit 0, one answer line, ok, one reply per call in order. */
function run(calls: Obj[], what: string): Obj[] {
  expect(buildError, 'the binary builds: cargo build --locked --bin deep-show').toBe('');
  const evidence = temp();
  const r = spawnSync(join(binDir, 'deep-show'), ['run'], {
    cwd: REPO, input: `${JSON.stringify({ evidence, calls })}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout ${(r.stdout ?? '').slice(0, 800)}; stderr ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const answer = JSON.parse(lines[0]!) as Json;
  expect(isObj(answer) && answer['ok'], `${what}: the scenario is answered ok; got ${show(answer, 800)}`).toBe(true);
  const replies = (answer as Obj)['replies'];
  expect(Array.isArray(replies) && replies.length === calls.length && replies.every(isObj), `${what}: one reply object per call; got ${show(replies, 800)}`).toBe(true);
  return replies as Obj[];
}

const install = (dir: string): Obj => ({ call: 'install_pack', id: PACK_ID, dir });

/** `install_pack`'s outcome and issues. */
function outcomeOf(reply: Obj, what: string): { outcome: string; issues: Obj[] } {
  const { outcome, issues } = reply;
  expect(typeof outcome === 'string' && Array.isArray(issues) && issues.every(isObj), `${what}: install_pack answers {outcome, issues}; got ${show(reply)}`).toBe(true);
  return { outcome: outcome as string, issues: issues as Obj[] };
}
function installed(reply: Obj, what: string): void {
  const r = outcomeOf(reply, what);
  expect([r.outcome, r.issues.length], `${what}: synth's pack check admits it (installed, no issue); got ${show(reply, 3000)}`).toEqual(['installed', 0]);
}

/** Every entry of `synth.preset@1` a `registries` reply lists, as `{name, kit}`. */
function presetEntries(reply: Obj): { name: string; kit: Json }[] {
  const found: { name: string; kit: Json }[] = [];
  const walk = (v: Json | undefined): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) {
      if (v['registry'] === 'synth.preset@1' && typeof v['name'] === 'string' && v['name'] !== 'synth.preset@1') {
        found.push({ name: v['name'], kit: isObj(v['kit']) ? v['kit']['verdict'] ?? null : v['kit'] ?? null });
      }
      Object.values(v).forEach(walk);
    }
  };
  walk(reply);
  return found;
}

/** The pack's manifest as committed, read whole; the test fails naming the file when it isn't there. */
function manifest(): Obj {
  const file = join(PACK_DIR, 'pack.json');
  expect(existsSync(file), `the first-party pack foley@1 is committed at packs/foley-1.0.0/pack.json`).toBe(true);
  const m = JSON.parse(readFileSync(file, 'utf8')) as Json;
  expect(isObj(m), 'pack.json holds an object').toBe(true);
  return m as Obj;
}

/** A copy of the pack folder whose `metal.scrape@1` gains `grains` after its output, of `kind`, cost raised by one. */
function variant(m: Obj, kind: string): string {
  const dir = join(temp(), 'foley-1.0.0');
  cpSync(PACK_DIR, dir, { recursive: true });
  const copy = structuredClone(m);
  const p = (copy['presets'] as Obj)[PLANTED_PRESET] as Obj;
  const nodes = p['nodes'] as Obj;
  expect(PLANTED_NODE.id in nodes, `${PLANTED_PRESET} has no node of its own named ${PLANTED_NODE.id}`).toBe(false);
  nodes[PLANTED_NODE.id] = kind === 'gain' ? { kind: 'gain', gain: 1 } : { kind, size: 0.05 };
  (p['edges'] as Json[]).push([p['out'] as string, PLANTED_NODE.id, 'in']);
  p['out'] = PLANTED_NODE.id;
  p['cost'] = (p['cost'] as number) + 1;
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify(copy, null, 2)}\n`);
  return dir;
}

describe(`${AC9} every foley@1 preset is a synth.preset@1 entry that passes synth's pack check; a planted node outside the closed list is refused`, () => {
  it(`${AC9} packs/foley-1.0.0 (foley@1.0.0) holds one synth.preset@1 preset per material × action over the closed node list, installs as deepbuild/foley with no issue, and \`registries\` lists all 90 as foley.<material>.<action>@1 entries of synth.preset@1 with kit PASS`, () => {
    const m = manifest();
    expect([m['name'], m['version']], 'the pack is foley at 1.0.0').toEqual(['foley', '1.0.0']);
    const presets = m['presets'];
    expect(isObj(presets), `pack.json carries presets: {"<material>.<action>@1" → preset}; got ${show(presets, 300)}`).toBe(true);
    const want = MATERIALS.flatMap((mat) => ACTIONS.map((act) => `${mat}.${act}@1`)).sort();
    expect(Object.keys(presets as Obj).sort(), 'one preset for each of the 10 materials × 9 actions, keyed <material>.<action>@1, and no other').toEqual(want);

    // Each is synth.preset@1's form over the closed list, read here from the manifest beside what the check says.
    const off: string[] = [];
    for (const [key, p] of Object.entries(presets as Obj)) {
      if (!isObj(p) || !isObj(p['nodes']) || !Array.isArray(p['edges']) || typeof p['out'] !== 'string' || !isObj(p['params']) || typeof p['cost'] !== 'number') {
        off.push(`${key}: not {nodes, edges, out, params, cost}`);
        continue;
      }
      for (const [id, n] of Object.entries(p['nodes'])) {
        const kind = isObj(n) ? n['kind'] : undefined;
        if (typeof kind !== 'string' || !NODES.has(kind)) off.push(`${key}: node ${id} is ${show(kind)}, outside the closed list`);
      }
    }
    expect(off, 'every foley preset is a synth preset over the closed node list').toEqual([]);

    const [inst, reg] = run([install(PACK_DIR), { call: 'registries' }], 'the foley pack installed, then the registries');
    installed(inst!, 'deepbuild/foley@1.0.0');
    const listed = new Map(presetEntries(reg!).map((e) => [e.name, e.kit]));
    const missing = want.map((k) => `foley.${k}`).filter((n) => listed.get(n) !== 'PASS').map((n) => `${n}: ${listed.has(n) ? `kit ${show(listed.get(n))}` : 'not an entry'}`);
    expect(missing, `every foley preset is an entry of synth.preset@1 named foley.<material>.<action>@1 with its kit passed; listed: ${show([...listed.keys()].filter((n) => n.startsWith('foley.')).slice(0, 20), 800)}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC9} a planted \`${PLANTED_PRESET}\` with a node \`${PLANTED_NODE.id}\` of kind \`${PLANTED_NODE.kind}\` is refused at pack check, naming the preset and the node; its twin with that node a gain of 1 installs`, () => {
    const m = manifest();
    const presets = m['presets'];
    expect(isObj(presets) && isObj(presets[PLANTED_PRESET]) && isObj((presets[PLANTED_PRESET] as Obj)['nodes']), `the pack holds ${PLANTED_PRESET} with its nodes`).toBe(true);

    const [twin] = run([install(variant(m, 'gain'))], 'the clean twin');
    installed(twin!, `the clean twin (${PLANTED_PRESET} with ${PLANTED_NODE.id} a gain of 1)`);

    const [planted] = run([install(variant(m, PLANTED_NODE.kind))], 'the planted pack');
    const r = outcomeOf(planted!, 'the planted pack');
    expect(r.outcome, `the planted pack is refused at pack check; got ${show(planted, 3000)}`).toBe('refused');
    const texts = r.issues.map((i) => JSON.stringify({ path: i['path'] ?? null, actual: i['actual'] ?? null, what: i['what'] ?? null }));
    const atPreset = texts.filter((_, i) => {
      const path = r.issues[i]!['path'];
      return typeof path === 'string' && (path === `presets/${PLANTED_PRESET}` || path.startsWith(`presets/${PLANTED_PRESET}/`));
    });
    expect(atPreset.length > 0, `an issue sits at presets/${PLANTED_PRESET}, naming the preset; got ${show(r.issues, 3000)}`).toBe(true);
    expect(atPreset.some((t) => t.includes(PLANTED_NODE.id) || t.includes(PLANTED_NODE.kind)), `the refusal of ${PLANTED_PRESET} names the node ${PLANTED_NODE.id} (${PLANTED_NODE.kind}); got ${atPreset.join(' ')}`).toBe(true);
  }, TIMEOUT);
});
