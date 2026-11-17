// AC7 #549.c5f03db3: Two copies whose builds differ only in the physics implementation's pinned version can't start a
// match: the second Join is refused, naming physics@1 and both versions, while two whose builds differ only in a bit,
// canonical logic implementation start and play to equal hashes; and the match record carries the runtime digest
//
// Three builds of `deep-show`, all at the base: `full`; `full,test-physics-rapier-patch` (#1920's: the physics
// implementation's rapier3d pin at another 0.36 patch, nothing else changed); and `full,test-logic-patch` (#533's: a
// patch release of the shipped logic implementation, bit and canonical, in its place). Each build's published plan
// (#1920's `schedule` call) gives its runtime digest and the versions the refusal must name. Each copy is a live copy
// in the app, through the shipped relay behind this suite's door.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { armyProgram, lockstepDoc, script, scripts } from './fixtures.ts';
import {
  AC, FULL, LOGIC_PATCH, PHYSICS_PATCH, TIMEOUT, framesThrough, hashFailures, isObject, linkFrom, liveCopy, livePair, none, obj, planScenario, playedOf, putEvidence, runShow,
  startDoor, startRelay, stopChildren, str, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp, type Door, type JsonObject,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL, PHYSICS_PATCH, LOGIC_PATCH], relay: true });
const certs = useCertificate();
useCleanup();
useChildren();
const closing = useClosers();
const temp = useTemp();
const STEPS = 200;

interface Plan { runtimeDigest: string; physics: string; logic: string }
/** A build's published plan (#1920): its runtime digest, the physics implementation's rapier3d pin and the logic
 * implementation's version, as the plan names them. */
async function planOf(set: string): Promise<Plan> {
  const r = await runShow(builds.show(set), planScenario(temp(), [{ call: 'schedule' }]), `the plan of ${set}`);
  const plan = r[0]!;
  const impl = (name: string): JsonObject => obj(obj(obj(plan['interfaces'], `${set}: interfaces`)[name], `${set}: interfaces.${name}`)['implementation'], `${set}: ${name}'s implementation`);
  const pin = obj(obj(impl('physics@1')['pins'], `${set}: physics@1's pins`)['rapier3d'], `${set}: physics@1's rapier3d pin`);
  return {
    runtimeDigest: str(plan['runtime_digest'], `${set}: runtime_digest`),
    physics: str(pin['version'], `${set}: the rapier3d pin's version`).replace(/^=/, ''),
    logic: str(impl('logic@1')['version'], `${set}: logic@1's implementation version`),
  };
}
async function relayDoor(): Promise<Door> {
  const relay = await startRelay(builds.relay(), certs());
  closing(() => relay.stop());
  const door = await startDoor(relay.host, certs());
  closing(() => door.close());
  return door;
}

describe(`${AC[7]} copies whose runtime digests differ can't start a match, and the record carries the digest`, () => {
  it(`${AC[7]} a second Join from a build with another physics pin is refused, naming physics@1 and both versions`, async () => {
    const [full, patch] = [await planOf(FULL), await planOf(PHYSICS_PATCH)];
    expect(patch.physics, 'the fixture: the two builds pin two versions of the physics backend').not.toBe(full.physics);
    expect(patch.runtimeDigest, 'the fixture: their runtime digests differ (#1920)').not.toBe(full.runtimeDigest);
    expect(patch.logic, 'the fixture: they differ in nothing of logic').toBe(full.logic);
    const door = await relayDoor();
    const program = armyProgram();
    const stores = [temp(), temp()];
    for (const s of stores) putEvidence(s, program.bytes);
    const document = lockstepDoc(program, { relay: door.url, hash_every: 1, timeout: 120 });
    const linkFile = join(temp(), 'link');
    // The shipped build opens the match; it is left waiting when the second Join is refused, and stopped by its PID.
    const first = liveCopy(builds.show(FULL), { evidence: stores[0]!, document, steps: STEPS, plays: script(1, STEPS), relayCa: certs().ca, linkTo: linkFile }, 'AC7 the shipped build\'s copy');
    first.catch(() => undefined);
    const link = await linkFrom(linkFile, 'AC7 the shipped build\'s copy', first);
    const second = await liveCopy(builds.show(PHYSICS_PATCH), { evidence: stores[1]!, document, steps: STEPS, plays: script(2, STEPS), relayCa: certs().ca, link }, 'AC7 the copy with another physics pin');
    stopChildren();
    await first.catch(() => undefined);
    const f: string[] = [];
    if (second.reply['code'] !== 'refused') f.push(`the second copy's play_match answers ${JSON.stringify(second.reply).slice(0, 300)}, not the code refused`);
    const after = second.after;
    if (after?.state !== 'refused') f.push(`the second copy's prompt is ${String(after?.state)}, not refused`);
    const text = after?.text ?? '';
    for (const [what, value] of [['the interface physics@1', 'physics@1'], [`the shipped build's version ${full.physics}`, full.physics], [`the other build's version ${patch.physics}`, patch.physics]] as const) {
      if (!text.includes(value)) f.push(`the refusal doesn't name ${what}: "${text.slice(0, 400)}"`);
    }
    const refused = after?.raw['refused'];
    if (!isObject(refused) || !('mismatch' in refused)) f.push(`the prompt's refused is ${JSON.stringify(refused ?? null)}, not a mismatch naming what differs`);
    if (framesThrough(door).length) f.push(`${framesThrough(door).length} frames crossed the relay though the match can't start`);
    none(f, 'two copies whose builds differ only in the physics pin');
  }, TIMEOUT);

  it(`${AC[7]} two builds that differ only in a bit, canonical logic implementation play to equal hashes, and each record carries the runtime digest`, async () => {
    const [full, patch] = [await planOf(FULL), await planOf(LOGIC_PATCH)];
    expect(patch.logic, 'the fixture: the two builds hold two versions of the logic implementation').not.toBe(full.logic);
    expect(patch.runtimeDigest, 'the fixture: a bit, canonical implementation leaves the runtime digest as it was (#1920)').toBe(full.runtimeDigest);
    const door = await relayDoor();
    const program = armyProgram();
    const stores: [string, string] = [temp(), temp()];
    for (const s of stores) putEvidence(s, program.bytes);
    const document = lockstepDoc(program, { relay: door.url, hash_every: 1, timeout: 120 });
    const pair = await livePair({ bins: [builds.show(FULL), builds.show(LOGIC_PATCH)], stores, linkFile: join(temp(), 'link'), document, steps: STEPS, plays: scripts(2, STEPS), relayCa: certs().ca }, 'AC7 the shipped build and the logic patch');
    const one = playedOf(pair.one.reply, 'AC7 the shipped build\'s copy');
    const two = playedOf(pair.two.reply, 'AC7 the logic patch\'s copy');
    const f: string[] = [];
    for (const c of [one, two]) {
      if (c.ran < STEPS - 8) f.push(`copy ${c.player} ran ${c.ran} of ${STEPS} match steps`);
      if (!c.record) { f.push(`copy ${c.player} has no record`); continue; }
      if (c.record.runtimeDigest !== full.runtimeDigest) f.push(`copy ${c.player}'s record carries the runtime digest ${c.record.runtimeDigest}, not its build's ${full.runtimeDigest}`);
      if (c.record.players !== 2) f.push(`copy ${c.player}'s record names ${c.record.players} players`);
    }
    f.push(...hashFailures(one, two, 'the shipped build\'s copy and the logic patch\'s', { hashEvery: 1, atLeast: STEPS - 10 }));
    if (one.record && two.record && one.record.moduleSetDigest !== two.record.moduleSetDigest) f.push('the two records carry two module-set digests');
    if (one.record && two.record && one.record.document !== two.record.document) f.push('the two records name two documents');
    none(f, 'two copies whose builds differ only in a bit, canonical logic implementation');
  }, TIMEOUT);
});
