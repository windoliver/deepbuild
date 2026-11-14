// #534's manual end-to-end check through deep-logic's JSON lines, outside the acceptance harness: a counter game
// saves slot 1, the process exits, a new process opens the save and plays on; then the newest save is cut short, and
// the program changes. Usage: node manual-e2e.mjs <deep-logic> <wat assembler> <work dir>
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [bin, wat, work] = process.argv.slice(2);
const sha = (b) => createHash('sha256').update(b).digest('hex');
// The work folder is printed as <work>, so no local path reaches the evidence.
const say = (s) => console.log(s.replaceAll(work, '<work>'));
function assemble(name, text) {
  writeFileSync(join(work, `${name}.wat`), text);
  const r = spawnSync(wat, [work, join(work, `${name}.wat`)], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(r.stderr);
  return readFileSync(join(work, `${name}.wasm`));
}
// The counter keeps n in a mutable global and a copy in memory at 8192; it writes n into `count` and asks for slot 1
// at the ends of steps 9 and 19 (saves at steps 10 and 20). `extra` adds a nop: a changed program.
const counter = (extra) => assemble(extra ? 'counter_nop' : 'counter', `(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $n (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64) (global.set $n (i32.const 1)))
  (func (export "step") (param $k i64)
    ${extra ? '(nop)' : ''}
    (global.set $n (i32.add (i32.mul (global.get $n) (i32.const 3)) (i32.wrap_i64 (local.get $k))))
    (i32.store (i32.const 8192) (global.get $n))
    (i32.store (i32.const 4096) (global.get $n))
    (i32.store (i32.const 4104) (i32.or (i64.eq (local.get $k) (i64.const 9)) (i64.eq (local.get $k) (i64.const 19))))))`);
const piece = (program) => ({
  seed: 534, items: { game: { kind: 'logic@1', params: { program: sha(program), writes: { count: { type: 'i32' }, request: { type: 'i32' } }, checkpoint: { every: 5 }, saves: { slots: 1, request: 'request' } } } },
  assets: { [sha(program)]: program.toString('base64') },
});
// Each runner process's exit status and whether it wrote to stderr, printed at the end.
const exits = [];
function call(c) {
  const program = c.piece.items.game.params.program.slice(0, 12);
  say(`deep-logic stdin ← ${JSON.stringify({ ...c, piece: `<the counter piece, program ${program}…>` })}`);
  const r = spawnSync(bin, [], { input: `${JSON.stringify(c)}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
  exits.push([r.status, r.stderr.length]);
  return JSON.parse(r.stdout);
}
// A reply without its `steps` and `file` keys; the note names the ones this reply had.
function short(o) {
  const cut = new Set();
  const text = JSON.stringify(o, (k, v) => (k === 'steps' || k === 'file' ? (cut.add(k), undefined) : v));
  return `${text}   (left out: ${[...cut].sort().join(', ') || 'nothing'})`;
}

const dir = join(work, 'saves');
mkdirSync(dir, { recursive: true });
const p = piece(counter(false));
const git = (...a) => spawnSync('git', a, { encoding: 'utf8' }).stdout.trim();
const clean = git('status', '--porcelain', '--', 'crates', 'Cargo.lock', 'Cargo.toml', 'docs/evidence/534/manual-e2e.mjs') === '' ? 'no uncommitted changes to crates, Cargo files or this script' : 'UNCOMMITTED changes to crates, Cargo files or this script';
say(`# Run at commit ${git('rev-parse', '--short=9', 'HEAD')} (${clean}), ${process.platform}/${process.arch}; deep-logic binary sha256 ${sha(readFileSync(bin))}`);
say('# 1. Bake 20 steps with a saves folder: the game asks for slot 1 in steps 9 and 19, and a save is taken as its step ends, so at steps 10 and 20; the process then exits.');
const baked = call({ call: 'bake', piece: p, track: [], steps: 20, saves_dir: dir });
say(`saves: ${JSON.stringify(baked.saves.map((s) => ({ slot: s.slot, step: s.step, hash: s.hash, deep_hash: s.deep_hash, write_ns: s.write_ns })))}   (only these keys of each save)`);
say(`checkpoints: ${JSON.stringify(baked.checkpoints)}   (of the bake's reply, only saves and checkpoints are shown)`);
say(`(node) files in saves  →  ${readdirSync(dir).sort().join(' ')}`);
const newest = baked.saves[1];
const header = readFileSync(join(dir, `${newest.hash}.save`)).subarray(0, readFileSync(join(dir, `${newest.hash}.save`)).indexOf(10)).toString();
say(`(node) first line of saves/${newest.hash}.save  →  ${header}`);
say('#    content is the sha256 of the hashes of the data assets the items name, one per line (params.assets; the program isn\'t one); this item names none, so it is the sha256 of nothing.');
say('# The never-quit run, 30 steps:');
const nq = call({ call: 'bake', piece: p, track: [], steps: 30 });
say(`checkpoints: ${JSON.stringify(nq.checkpoints)}   (only checkpoints of the reply)`);
say('# 2. A new process opens slot 1 and plays on to step 30: its checkpoints should equal the never-quit run\'s from 20.');
const o = call({ call: 'open_save', piece: p, saves_dir: dir, slot: 1, track: [], steps: 30 });
say(short(o));
// Steps and full-state hashes only: `ns` is each run's own timing.
const hashes = (list) => JSON.stringify(list.map((c) => [c.step, c.deep_hash]));
const same = hashes(o.checkpoints.game) === hashes(nq.checkpoints.game.filter((c) => c.step >= 20));
say(`opened run's checkpoints equal the never-quit run's from step 20, by step and deep_hash (ns is each run's own timing): ${same}`);
say('# 3. Cut the newest save short by one byte and open the slot again: it should be named damaged, and the save at step 10 opens.');
const file = join(dir, `${newest.hash}.save`);
const before = readFileSync(file).length;
truncateSync(file, before - 1);
say(`(node) cut the last byte of saves/${newest.hash}.save  →  ${before} bytes, now ${readFileSync(file).length}`);
const o2 = call({ call: 'open_save', piece: p, saves_dir: dir, slot: 1, track: [], steps: 15 });
say(short(o2));
say(`opened at the deep hash recorded at step 10: ${o2.deep_hash.game === baked.saves[0].deep_hash.game}`);
say('# 4. Change the program (one nop) and open with no migration: refused, naming both layout hashes. The step-20 save is still cut, so the save refused is the one at step 10. While no program exports layout_at, a save\'s layout is the sha256 of the program bytes (the header\'s `program` field is the program after the rewrite).');
const changed = piece(counter(true));
const o3 = call({ call: 'open_save', piece: changed, saves_dir: dir, slot: 1, track: [], steps: 15 });
say(short(o3));
say(`sha256 of the old program bytes ${sha(counter(false))}, of the new ${sha(counter(true))}`);
say(`(node) each deep-logic process's [exit status, bytes on stderr], in order  →  ${JSON.stringify(exits)}`);
