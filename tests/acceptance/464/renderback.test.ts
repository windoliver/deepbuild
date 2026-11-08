// #464.c29f1d4c: "Render-back of a 2D print look returns the Vello CPU snapshot and a GPU snapshot labelled
// display_only, and a check that tries to read the GPU one is refused"
//
// Through #393's hub (`deep-show run`, the full build): an agent's `deep show` of a 960 × 540 2D film under a print look
// (asset `print-464@1`, kept in the evidence store by its SHA-256: a halftoned cyan separation over a solid rose one,
// and grain), at t = 0 with `include: ["issues", "pixels"]`. The reply holds two snapshots: one without `display_only`,
// the Vello CPU render every 2D render-back returns, and one with `display_only: true`, the GPU snapshot from this
// machine; both are PNGs of 960 × 540 in the evidence store under their SHA-256. A second run of the hub on the same
// machine returns the same GPU snapshot. Its claim has two requirements, each a pixel check that names a snapshot to
// read (`{kind: "render.contrast", snapshot: <sha256>}`): `deep show --check` with the claim, then `verdict`, gives the
// GPU snapshot's row a result other than PASS whose row carries the code `display_only` and names that snapshot, while
// the twin reading the CPU snapshot carries no `display_only`. Wrong programs: no GPU snapshot; a GPU snapshot not
// labelled; a check that reads it.
import { describe, expect, it } from 'vitest';
import {
  AC, type JsonObject, arr, decodePng, num, obj, objs, readEvidence, requireGpu, runShow, seedEvidence, shown, str, useBins, useOut, look2d, SHA,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const out = useOut();
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
const DOC = ulid('01JB0464D', 1);
const SIZE: [number, number] = [960, 540];
const AGENT = { id: 'sess-print', thread: 'thread-print', name: 'Test agent: print look', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 },
  { pid: 4101, ppid: 4100, start: 1_100 }, { pid: 4102, ppid: 4101, start: 1_200 },
];
const IN_AGENT: JsonObject = { pid: 4102, start: 1_200 };
const CLAIM = `claim:${ulid('01JB0464C', 1)}`;
const REQ = { gpu: `req:${ulid('01JB0464Q', 1)}`, cpu: `req:${ulid('01JB0464Q', 2)}` };
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' };
const PRINT = look2d('print-464', { cyan: '#28aae6', rose: '#e65a96' }, {
  separations: [
    { role: 'cyan', halftone: { angle: 15, pitch: 8, spot: 'round' }, offset: [3, 0], order: 0, overprint: 'multiply', anchor: 'plate' },
    { role: 'rose', halftone: 'solid', offset: [0, 0], order: 1, overprint: 'multiply', anchor: 'plate' },
  ],
  finish: [{ grain: { amount: '4%', size: '1px', tone: 'flat', rate: 24 } }],
});

/** The film as the agent sends it (#1162's form: items keyed by ID, no layers), its look by asset. */
function film(lookSha: string): JsonObject {
  const shape = (id: string, order: string, b: number[], role: string): JsonObject => ({ id, kind: 'rect@1', name: id, order, params: { box: b, paint: { fill: { role }, opacity: 0.6 } } });
  return {
    format: 1, profile: 'film', seed: 464, title: 'A two-ink print', description: 'Two overlapping inks printed as separations under grain.', size: SIZE,
    transport: { span: '2s' }, look: { asset: 'print-464@1', theme: 'light' }, requires: { modules: { marks2d: '^1', effects: '^1' } },
    assets: { 'print-464': { sha256: lookSha, license: LICENSE } },
    items: { sheet: shape('sheet', 'a0', [120, 100, 420, 300], 'cyan'), band: shape('band', 'a1', [380, 180, 460, 260], 'rose') },
  };
}
function scenario(evidence: string, calls: JsonObject[], claims: JsonObject = {}): JsonObject {
  return {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: AGENT.process } }, processes: PROCESSES,
    panels: { main: { rect: [0, 0, SIZE[0], SIZE[1]] } }, docs: { [DOC]: { panel: 'main' } }, claims, record: {}, calls,
  };
}
const show = (document: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ call: 'deep show', peer: IN_AGENT, doc: DOC, document, t: '0s', size: SIZE, include: ['issues', 'pixels'], ...extra });

describe(`${AC[4]} render-back of a 2D print look: the Vello CPU snapshot, and a GPU snapshot no check reads`, () => {
  it(`${AC[4]} render-back returns the CPU snapshot and a GPU snapshot labelled display_only, and a check that tries to read the GPU one is refused`, async () => {
    requireGpu();
    const evidence = out();
    const lookSha = seedEvidence(evidence, Buffer.from(JSON.stringify(PRINT)));
    const document = film(lookSha);
    const snaps = (reply: JsonObject, what: string): { gpu: string; cpu: string } => {
      expect(reply['outcome'], `${what}: the film is presented: ${shown(reply)}`).toBe('presented');
      const s = objs(reply['snapshots'], `${what}: snapshots`);
      expect(s.length, `${what}: two snapshots, the CPU one and the GPU one: ${shown(reply['snapshots'])}`).toBe(2);
      const gpu = s.filter((x) => x['display_only'] === true);
      const cpu = s.filter((x) => x['display_only'] !== true);
      expect(gpu.length, `${what}: exactly one snapshot is labelled display_only`).toBe(1);
      expect(cpu.length, `${what}: the other is the CPU snapshot, not display_only`).toBe(1);
      for (const x of s) {
        expect(str(x['sha256'], `${what}: a snapshot's sha256`)).toMatch(SHA);
        expect([num(x['w'], 'w'), num(x['h'], 'h')], `${what}: each snapshot is ${SIZE.join(' × ')}`).toEqual(SIZE);
      }
      return { gpu: str(gpu[0]!['sha256'], 'gpu'), cpu: str(cpu[0]!['sha256'], 'cpu') };
    };
    const [first] = runShow(bins.bin('deep-show'), [scenario(evidence, [show(document)])], `${AC[4]} render-back`)[0]!;
    const one = snaps(first!, 'render-back');
    expect(one.gpu, 'the GPU snapshot is another picture than the CPU one').not.toBe(one.cpu);
    for (const [name, sha] of Object.entries(one)) {
      const png = decodePng(await readEvidence(evidence, sha));
      expect([png.width, png.height], `the ${name} snapshot is kept in the evidence store as a ${SIZE.join(' × ')} PNG`).toEqual(SIZE);
    }

    const claims: JsonObject = {
      [CLAIM]: {
        session: AGENT.id, deliverables: [DOC],
        requirements: [
          { id: REQ.gpu, check: { kind: 'render.contrast', snapshot: one.gpu } },
          { id: REQ.cpu, check: { kind: 'render.contrast', snapshot: one.cpu } },
        ],
      },
    };
    const [replies] = runShow(bins.bin('deep-show'), [scenario(evidence, [show(document), show(document, { check: true, claim: CLAIM }), { call: 'verdict', claim: CLAIM }], claims)], `${AC[4]} the check`);
    const again = snaps(replies![0]!, 'render-back on a second run');
    expect(again.gpu, 'the second run on this machine returns the same GPU snapshot').toBe(one.gpu);
    const rows = arr(obj(replies![2], 'verdict')['requirements'], `verdict: requirements: ${shown(replies![2])}`).map((r, i) => obj(r, `requirements[${i}]`));
    const row = (id: string): JsonObject => { const r = rows.find((x) => x['id'] === id); expect(r, `the verdict has a row for ${id}`).toBeDefined(); return r!; };
    const gpuRow = row(REQ.gpu); const cpuRow = row(REQ.cpu);
    expect(gpuRow['result'], `the check reading the GPU snapshot is refused, not passed: ${shown(gpuRow)}`).not.toBe('PASS');
    expect(JSON.stringify(gpuRow), 'its row carries the code display_only').toContain('"display_only"');
    expect(JSON.stringify(gpuRow), 'its row names the GPU snapshot').toContain(one.gpu);
    expect(JSON.stringify(cpuRow), `the twin reading the CPU snapshot isn't refused as display_only: ${shown(cpuRow)}`).not.toContain('display_only');
  });
});
