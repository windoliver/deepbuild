// Criterion 7 and the Proof's "three shipped journeys" (README: Criterion 7): the check runs in a lane on the shipped
// journeys for Needs you, a session page and the project page, and reports each one. `motion_check` with `shipped: true`
// runs them in real replicas on #338's fixture record and answers one entry a journey; the lane runs the same check, and
// its output must hold each journey's name and the hash of the recording the check took, which a lane that printed names
// and nothing else could not know. A replica planted with a jump on every action (DEEP_DRIVE_PLANT=jumps-on-act) must
// fail all three, naming the jump; without it none gives a finding.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Drive, NOT_MEASURED, REPO, STEP, cleanup, checked, requireMacos, type Obj } from './helpers.ts';

afterAll(cleanup, 60_000);

const NAMES = ['needs-you', 'project', 'session'];
const FIXTURE = join(REPO, 'docs', 'spikes', '338', 'fixtures', 'needs-you.events.jsonl');
const events = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { session_id: string; event: Obj });
const ASKS = new Set(events.filter((e) => e.event.kind === 'ask.created').map((e) => `ask:${e.event.id}`));
const SESSIONS = new Set(events.map((e) => e.session_id));

const journeys = (reply: Obj): Obj[] => reply.journeys as Obj[];
const named = (reply: Obj, name: string): Obj => {
  const found = journeys(reply).filter((j) => j.name === name);
  expect(found.length, `one report for ${name}: ${JSON.stringify(journeys(reply).map((j) => j.name))}`).toBe(1);
  return found[0]!;
};

async function shipped(plant?: string): Promise<Obj> {
  requireMacos();
  const drive = await Drive.start(plant ? { plant } : {});
  try {
    return await checked(drive, { shipped: true });
  } finally {
    await drive.stop();
  }
}

describe('#1427 AC7 the check runs on the shipped journeys for Needs you, a session page and the project page, one report each', () => {
  let plain: Obj;
  it('a report for each of the three, from a real recording of the journey: its steps, its inputs and the ids the record gave its rows', async () => {
    plain = await shipped();
    expect(journeys(plain).map((j) => j.name).sort(), 'exactly the three').toEqual(NAMES);
    for (const name of NAMES) {
      const j = named(plain, name);
      expect(Array.isArray(j.findings), `${name} lists its findings: ${JSON.stringify(j).slice(0, 300)}`).toBe(true);
      expect(['PASS', 'INCONCLUSIVE'], `${name}'s claim: ${j.claim}, findings ${JSON.stringify(j.findings)}`).toContain(j.claim);
      expect(String(j.pacing), `${name} says pacing was not measured`).toContain(NOT_MEASURED);
      expect(j.recording.step, `${name} is sampled each 1/120 s`).toBe(STEP);
      expect(j.recording.frames, `${name} runs for at least a second of the clock`).toBeGreaterThanOrEqual(120);
      expect((j.recording.inputs as unknown[]).length, `${name} does something: at least one input`).toBeGreaterThanOrEqual(1);
      expect(j.recording.sha256, `${name}'s recording is hashed`).toMatch(/^[0-9a-f]{64}$/);
      const ids = j.recording.elements as string[];
      expect(Array.isArray(ids) && ids.length > 0, `${name} lists the ids of the elements it recorded`).toBe(true);
      expect(ids.some((id) => [...SESSIONS].some((s) => id.includes(s))), `${name}'s recording keys a session row by the session's ID, not its place`).toBe(true);
      expect(ids.filter((id) => /(^|[-_:/])(row|item|child|node|cell)[-_:]?\d+$|\[\d+\]$/.test(id)), `${name}: no id is a position`).toEqual([]);
    }
    const needs = named(plain, 'needs-you').recording.elements as string[];
    expect(needs.some((id) => [...ASKS].some((a) => id.includes(a))), 'Needs you keys each ask\'s row by the ask\'s handle').toBe(true);
    expect(plain.findings, 'no shipped journey has a finding today').toEqual([]);
    expect(plain.claim, 'and the claim does not fail').not.toBe('FAIL');
  }, 1_800_000);

  it('the same shipped journeys in another process give the same recordings and findings, byte for byte', async () => {
    const again = await shipped();
    const view = (r: Obj) => JSON.stringify(journeys(r).map((j) => [j.name, j.findings, j.claim, j.recording.sha256, j.recording.frames]));
    expect(view(again)).toBe(view(plain ?? await shipped()));
  }, 1_800_000);

  it('a replica planted with a jump on every action fails all three, naming the jump, and the report says which journey', async () => {
    const planted = await shipped('jumps-on-act');
    expect(planted.claim).toBe('FAIL');
    for (const name of NAMES) {
      const j = named(planted, name);
      expect(j.claim, `${name} fails`).toBe('FAIL');
      const jumps = (j.findings as Obj[]).filter((f) => f.finding === 'jump');
      expect(jumps.length, `${name} has a jump, naming its element and time: ${JSON.stringify(j.findings).slice(0, 300)}`).toBeGreaterThanOrEqual(1);
      expect(jumps.every((f) => typeof f.element === 'string' && Number.isInteger(f.t) && typeof f.value === 'number' && f.value > 0.25)).toBe(true);
    }
    const top = planted.findings as Obj[];
    expect(top.length, 'the top-level findings are every journey\'s').toBe(journeys(planted).reduce((n, j) => n + (j.findings as unknown[]).length, 0));
    expect(top.every((f) => NAMES.includes(f.journey)), 'each names its journey').toBe(true);
  }, 1_800_000);
});

describe('#1427 AC7 the lane', () => {
  it('scripts/lanes.mjs has a motion lane, and running its commands reports each shipped journey with its recording\'s hash', async () => {
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { checks: { name: string; commands: string[][] }[] };
    const lane = lanes.checks.find((l) => /motion/i.test(l.name));
    expect(lane, `a lane named motion among ${lanes.checks.map((l) => l.name).join(', ')}`).toBeTruthy();
    const reference = await shipped();
    let out = '';
    for (const [command, ...args] of lane!.commands) {
      const r = spawnSync(command!, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000 });
      out += `${r.stdout}\n${r.stderr}\n`;
      expect(r.status, `${[command, ...args].join(' ')} on the shipped journeys, which have no finding: ${out.slice(-1500)}`).toBe(0);
    }
    for (const name of NAMES) {
      expect(out, `the lane's report names ${name}`).toContain(name);
      const hash = named(reference, name).recording.sha256 as string;
      expect(out, `and holds the hash of ${name}'s recording, which only a run of it could print`).toContain(hash.slice(0, 12));
    }
    expect(out.toLowerCase(), 'and says what it can\'t see').toContain(NOT_MEASURED);
  }, 3_600_000);
});
