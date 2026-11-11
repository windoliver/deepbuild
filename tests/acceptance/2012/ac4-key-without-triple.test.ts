// #2012.562a3985: a golden recorded on the reference Mac binds the bake key without the target triple, records the
// triple in its machine, and passes on Linux; a planted change to the document still fails it there, naming the key.
//
// The golden's `machine` names this Mac's target triple (README: `machine.target`), as its `record_on` does, and its
// `bake_key` is the bake key without the triple (Golden): the replay on Linux x86_64, in the #1983 lane's pinned image
// as linux/amd64, computes that same key there and passes, while a plain bake's key, which binds the target triple
// (Bake), differs between the two machines. The planted change is the test's own: the same document with the flyer's x
// velocity one f32 ulp higher (1.5 → 1.5000001192092896), replayed against the golden on Linux; it must fail under
// another key, its failure naming the golden's key.
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_TIMEOUT, CRITERIA, HEX64, LINUX_X86, answered, arr, ask, bake, hostTriple, keyOf, nextUp, none, obj, onLane, pileAndFlyer, prebuild,
  recordHere, referenceMac, show, verifyGolden, type JsonObject,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];
const N = 240;

/** The world with the flyer's x velocity one f32 ulp higher: the smallest change to the document. */
function plantedDocument(w: JsonObject): JsonObject {
  const bodies = obj(w['bodies'], 'bodies');
  const ball = obj(bodies['ball'], 'bodies.ball');
  const velocity = obj(ball['velocity'], 'ball.velocity');
  const [vx, vy, vz] = arr(velocity['linear'], 'ball.velocity.linear') as number[];
  return { ...w, bodies: { ...bodies, ball: { ...ball, velocity: { ...velocity, linear: [nextUp(vx!), vy!, vz!] } } } };
}

/** The replay of a changed document fails under another key, naming the golden's key. */
function plantedFailures(run: JsonObject, key: string): string[] {
  if (run['ok'] !== true) return [`the replay of the changed document doesn't answer: ${show(run)}`];
  const f: string[] = [];
  if (run['target'] !== LINUX_X86) f.push(`it ran on ${show(run['target'])}, not ${LINUX_X86}`);
  if (run['verdict'] !== 'FAIL') f.push(`the verdict is ${show(run['verdict'])}, not FAIL: a changed document passes the golden`);
  const own = run['bake_key'];
  if (typeof own !== 'string' || !HEX64.test(own)) f.push(`the replay names no bake key of its own: ${show(own)}`);
  else if (own === key) f.push('the changed document computes the golden\'s key: the key doesn\'t bind the document');
  const refused = run['refused'];
  if (typeof refused !== 'string' || !refused.includes(key)) f.push(`the failure doesn't name the golden's key ${key}: refused is ${show(refused)}`);
  return f;
}

describe(`${ID} a golden binds the bake key without the target triple, records the triple in its machine, and passes on Linux; a changed document fails there, naming the key`, () => {
  it(`${ID} a golden recorded on this Mac names its triple in its machine, its key is the same on Linux x86_64 where it passes, and the same golden replayed with the flyer's x velocity one ulp higher fails there naming that key`, () => {
    referenceMac();
    const w = pileAndFlyer();
    const golden = recordHere(w, N, [LINUX_X86]);
    const host = hostTriple();
    expect(obj(golden['machine'], 'golden: machine')['target'], `the golden records the target triple ${host} in its machine: ${show(golden['machine'])}`).toBe(host);
    const key = golden['bake_key'] as string;
    const hereKey = keyOf(ask([bake(w, N, { read: [] })], { where: 'this Mac' })[0]!, 'this Mac\'s bake');

    const [linux, bakedThere, planted] = onLane('linux/amd64', [verifyGolden(golden, w, N), bake(w, N, { read: [] }), verifyGolden(golden, plantedDocument(w), N)]);
    const run = answered(linux, 'the Linux x86_64 replay');
    expect(run['target'], 'the replay ran on Linux x86_64').toBe(LINUX_X86);
    expect(run['bake_key'], 'Linux x86_64 computes the golden\'s key: the key binds no target triple').toBe(key);
    expect(run['verdict'], `the golden passes on Linux: ${show(run)}`).toBe('PASS');
    expect(keyOf(bakedThere!, 'the Linux x86_64 bake'), 'a plain bake\'s key binds each machine\'s target triple, so it differs between the two machines while the golden\'s doesn\'t').not.toBe(hereKey);

    none(plantedFailures(planted!, key), 'the changed document fails the golden on Linux, naming the key');
  }, CONTAINER_TIMEOUT);
});
