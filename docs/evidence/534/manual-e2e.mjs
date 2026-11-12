// #534's manual end-to-end check through deep-logic's JSON lines, outside the acceptance harness: a counter game
// saves slot 1, the process exits, a new process opens the save and plays on; then the newest save is cut short, and
// the program changes. Usage: node manual-e2e.mjs <deep-logic> <wat assembler> <work dir>
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [bin, wat, work] = process.argv.slice(2);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const say = (s) => console.log(s);
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
function call(c) {
  say(`$ echo '${JSON.stringify({ ...c, piece: '…' })}' | deep-logic`);
  const r = spawnSync(bin, [], { input: `${JSON.stringify(c)}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
  const reply = JSON.parse(r.stdout);
  return reply;
}
const short = (o) => JSON.stringify(o, (k, v) => (k === 'steps' || k === 'file' ? undefined : v));

const dir = join(work, 'saves');
mkdirSync(dir, { recursive: true });
const p = piece(counter(false));
say('# 1. Bake 20 steps with a saves folder: the game asks for slot 1 at the ends of steps 9 and 19; the process then exits.');
const baked = call({ call: 'bake', piece: p, track: [], steps: 20, saves_dir: dir });
say(`saves: ${JSON.stringify(baked.saves.map((s) => ({ slot: s.slot, step: s.step, hash: s.hash, deep_hash: s.deep_hash, write_ns: s.write_ns })))}`);
say(`checkpoints: ${JSON.stringify(baked.checkpoints)}`);
say(`$ ls saves  →  ${readdirSync(dir).sort().join(' ')}`);
const newest = baked.saves[1];
const header = readFileSync(join(dir, `${newest.hash}.save`)).subarray(0, readFileSync(join(dir, `${newest.hash}.save`)).indexOf(10)).toString();
say(`$ head -1 saves/${newest.hash}.save  →  ${header}`);
say('# The never-quit run, 30 steps:');
const nq = call({ call: 'bake', piece: p, track: [], steps: 30 });
say(`checkpoints: ${JSON.stringify(nq.checkpoints)}`);
say('# 2. A new process opens slot 1 and plays on to step 30: its checkpoints should equal the never-quit run\'s from 20.');
const o = call({ call: 'open_save', piece: p, saves_dir: dir, slot: 1, track: [], steps: 30 });
say(short(o));
// Steps and full-state hashes only: `ns` is each run's own timing.
const hashes = (list) => JSON.stringify(list.map((c) => [c.step, c.deep_hash]));
const same = hashes(o.checkpoints.game) === hashes(nq.checkpoints.game.filter((c) => c.step >= 20));
say(`opened run's checkpoints equal the never-quit run's from step 20: ${same}`);
say('# 3. Cut the newest save short by one byte and open the slot again: it should be named damaged, and the save at step 10 opens.');
const file = join(dir, `${newest.hash}.save`);
truncateSync(file, readFileSync(file).length - 1);
const o2 = call({ call: 'open_save', piece: p, saves_dir: dir, slot: 1, track: [], steps: 15 });
say(short(o2));
say(`opened at the deep hash recorded at step 10: ${o2.deep_hash.game === baked.saves[0].deep_hash.game}`);
say('# 4. Change the program (one nop) and open with no migration: refused, naming both program hashes.');
const changed = piece(counter(true));
const o3 = call({ call: 'open_save', piece: changed, saves_dir: dir, slot: 1, track: [], steps: 15 });
say(short(o3));
say(`old program ${sha(counter(false))}, new program ${sha(counter(true))}`);
