// #2793: `deep.registerPort` is published in the extension API and has no row in the hub-slot table.
//
// AC1 reads packages/contracts/hub-slots.json against the design's slot table row (README, Expected values) and
//     holds the row's kit to its planted wrong fill through the conformance package's `slotProblems`.
// AC2 runs `node scripts/slots-check.mjs` on the shipped contract.
// AC3 holds tests/acceptance/349/slot-table.test.ts and the three files it imports to their blobs at the base
//     commit, and runs that file with vitest: four cases, all passed.
//
// The tools are #349's own (its temp folders, its lazy conformance entry, its `admittingKit` wrong program), so
// this file adds none.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformance, NODE, REPO, SLOTS_CHECK, tempDir } from '../349/helpers.ts';
import { readApi, readTable } from '../349/slotting.ts';
import { admittingKit } from '../349/wrong.ts';

const PORT = 'deep.registerPort';
// The design's slot table (docs/technical-design.md, Composition, Hub slots):
// | `deep.registerPort` | `port@1` | many, at most 8 on a document | a port that sends on a seek | R6 |
const INTERFACE = 'port@1';
const FILLS = 'many, at most 8 on a document';
const SEEK = /seek/;
const D1 = /^d1:[0-9a-f]{64}$/;

const portRows = () => readTable().filter((row) => row.method === PORT);
/** The frozen digests where the contracts package keeps them: packages/contracts/digests.json. */
const frozen = (): Record<string, string> => JSON.parse(readFileSync(join(REPO, 'packages/contracts/digests.json'), 'utf8')) as Record<string, string>;
const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', NO_COLOR: '1' };

describe('#2793 AC1 packages/contracts/hub-slots.json has exactly one row for deep.registerPort, as the design\'s slot table gives it', () => {
  it('AC1 one row: interface port@1 at its frozen digest, fills "many, at most 8 on a document", a kit, and a planted wrong fill that sends on a seek', () => {
    const rows = portRows();
    expect(rows.length, `rows for ${PORT} in hub-slots.json`).toBe(1);
    const row = rows[0]!;
    expect(row.variant, 'the published API names no variant for it').toBeNull();
    expect(row.interface).toBe(INTERFACE);
    const digest = frozen()[INTERFACE];
    expect(digest, `${INTERFACE} has a frozen digest in packages/contracts/digests.json`).toMatch(D1);
    expect(row.digest, `the row's digest is ${INTERFACE}'s frozen one`).toBe(digest);
    expect(row.fills).toBe(FILLS);
    expect(row.kit, 'the row names a kit').toEqual(expect.any(String));
    expect(row.planted.filter((name) => SEEK.test(name)), `the row plants a port that sends on a seek: ${JSON.stringify(row.planted)}`).not.toEqual([]);
  });

  it('AC1 the row\'s kit ships in the conformance package and refuses each planted fill; (wrong program) the same kit admitting the seek fill is refused, naming the fill', async () => {
    const { kits, slotKits, slotProblems } = await conformance();
    const api = readApi().filter((e) => e.method === PORT);
    const rows = portRows();
    expect(api.length, `${PORT} is in the published extension API`).toBe(1);
    expect(rows.length, `rows for ${PORT} in hub-slots.json`).toBe(1);
    const row = rows[0]!;
    expect(slotProblems(api, rows, [...slotKits(), ...kits()]), 'the shipped kits hold the row whole').toEqual([]);
    const kit = slotKits().find((k) => k.slot === row.kit);
    expect(kit, `${row.kit} is a slot kit the conformance package ships`).toBeDefined();
    const seek = row.planted.find((name) => SEEK.test(name));
    expect(seek, `the row plants a port that sends on a seek: ${JSON.stringify(row.planted)}`).toBeDefined();
    const problems = slotProblems(api, rows, [await admittingKit(kit!, seek!)]);
    const admitted = problems.filter((p) => p.fill === seek);
    expect(admitted, `the check names the admitted fill: ${JSON.stringify(problems)}`).not.toEqual([]);
    expect(admitted[0]!.method).toBe(PORT);
  }, 300_000);
});

describe('#2793 AC2 node scripts/slots-check.mjs exits 0 and prints PASS slots, with no line naming deep.registerPort', () => {
  it('AC2 the slot check on the shipped contract', () => {
    const r = spawnSync(NODE, [SLOTS_CHECK], { cwd: REPO, encoding: 'utf8', timeout: 300_000, env });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    expect(r.status, out).toBe(0);
    expect(r.stdout).toMatch(/^PASS slots/m);
    expect(out.split('\n').filter((line) => line.includes(PORT)), 'lines naming the slot').toEqual([]);
    expect(out.split('\n').filter((line) => /^(FAIL|BLOCKED)\b/.test(line)), 'FAIL or BLOCKED lines').toEqual([]);
  }, 320_000);
});

describe('#2793 AC3 tests/acceptance/349/slot-table.test.ts passes, all four cases, unchanged', () => {
  // git's blob IDs at the base commit 0f34aacbe: the test file and the three files it imports.
  const BASE_BLOBS: Record<string, string> = {
    'slot-table.test.ts': '1e742fd80b0b8d5bc0787979fd58be5873467eb4',
    'slotting.ts': '1d7209d500ed243ad0fbd38c3b565de508de2890',
    'wrong.ts': '58881af4c1862268c39e791dd773d89ba7892315',
    'helpers.ts': '2acce4e5a447bbc078fe048c4b1fc700d4a3060c',
  };
  const blobId = (file: string): string => {
    const bytes = readFileSync(file);
    return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  };

  it('AC3 the file and what it imports are the base commit\'s, byte for byte', () => {
    for (const [name, id] of Object.entries(BASE_BLOBS)) expect(blobId(join(REPO, 'tests/acceptance/349', name)), `tests/acceptance/349/${name}`).toBe(id);
  });

  it('AC3 vitest runs its four cases and each passes', () => {
    const report = join(tempDir('2793'), 'report.json');
    const r = spawnSync(NODE, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', join(REPO, 'tests/acceptance/349'), 'slot-table.test.ts', '--reporter=json', `--outputFile=${report}`], {
      cwd: REPO, encoding: 'utf8', timeout: 900_000, env,
    });
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
    expect(existsSync(report), `vitest wrote its report: ${out}`).toBe(true);
    const files = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string; assertionResults: { title: string; status: string; failureMessages: string[] }[] }[] }).testResults;
    expect(files.map((f) => f.name.replace(/^.*\//, ''))).toEqual(['slot-table.test.ts']);
    const cases = files[0]!.assertionResults;
    expect(cases.length, 'cases collected').toBe(4);
    expect(cases.filter((c) => c.status !== 'passed').map((c) => `${c.status}: ${c.title}\n${c.failureMessages.join('\n')}`), 'cases that did not pass').toEqual([]);
    expect(r.status, out).toBe(0);
  }, 920_000);
});
