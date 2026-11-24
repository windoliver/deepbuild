// e2e for #3360: deep-show run of the shipped readers.board at 0s, base binary vs fix binary.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const S = '/private/tmp/claude-501/-Users-sophiawj-private-deepbuild-core--claude-worktrees-competent-cori-c426a4/8f56c42c-0c2b-4406-94d3-6241338f156c/scratchpad';
const DOC = '01JB327800000000000000000A';
const YOU = { pid: 3002, start: 3000 };
function run(bin, calls) {
  const ev = mkdtempSync(join(tmpdir(), 'e2e-3360-'));
  const sc = { evidence: ev, sessions: {}, processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: YOU.pid, ppid: 1, start: YOU.start }],
    panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } }, goldens: join(ev, 'goldens'), calls };
  const r = spawnSync(bin, ['run'], { cwd: join(S, 'repo'), input: JSON.stringify(sc) + '\n', encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Error(`exit ${r.status}: ${r.stderr.slice(-1500)}`);
  const out = JSON.parse(r.stdout.split('\n')[0]);
  if (!out.ok) throw Error(JSON.stringify(out).slice(0, 1500));
  return { replies: out.replies, ev };
}
for (const [label, dir] of [['base dbbddd5dd', 'base-bin'], ['fix', 'fix-bin']]) {
  const bin = join(S, dir, 'deep-show');
  const [manifest] = run(bin, [{ call: 'manifest' }]).replies;
  const document = manifest.fixtures.find((x) => x.name === 'parity/logic/readers.board').document;
  const { replies, ev } = run(bin, [
    { call: 'deep show', peer: YOU, doc: DOC, document, include: ['issues'], t: '0s' },
    { call: 'eval', doc: DOC, t: '0s', arrays: ['counter.presses'], texts: true, pixels: true },
  ]);
  const [shown, frame] = replies;
  console.log(`== ${label}: ${bin}`);
  console.log(`deep show outcome ${shown.outcome}; issues ${shown.issues.length}`);
  for (const i of shown.issues) console.log(`  ${i.severity} ${i.code} ids ${JSON.stringify(i.ids)} actual ${JSON.stringify(i.actual)}`);
  console.log(`eval outcome ${frame.outcome}; arrays ${JSON.stringify(frame.arrays)}; texts ${JSON.stringify(frame.texts)}`);
  const sha = frame.snapshots[0].sha256;
  const png = join(S, `e2e-${dir}.png`);
  copyFileSync(join(ev, sha.slice(0, 2), sha.slice(2)), png);
  console.log(`snapshot ${sha} -> ${png}`);
}
