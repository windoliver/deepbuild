// #2011.3daf6b1d: with groups player, ground, shot and enemy and a brief that locks player–ground and shot–enemy to touch
// and shot–player never to touch, physics.pairs passes a world whose matrix meets all three and reports its 10 group
// pairs. Its planted worlds: ground's `collides` omits player while player's names ground (fails, naming player–ground and
// both shapes); shot's `collides` names player (fails, naming shot–player); a shape whose `member` is empty (refused,
// naming it).
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, arr, ask, failuresNaming, matrixFailures, none, obj, pairsCall, pairsOf, prebuild, show, use, world,
  type Brief, type JsonObject, type Pairs, type Use,
} from './helpers.ts';

prebuild();

const GROUPS = ['player', 'ground', 'shot', 'enemy'] as const;
type Group = (typeof GROUPS)[number];
const BRIEF: Brief = { touch: [['player', 'ground'], ['shot', 'enemy']], never: [['shot', 'player']] };

/** Each body's one shape use: a member of its own group, colliding with the groups given. */
const COLLIDES: Record<Group, Group[]> = {
  player: ['ground', 'enemy', 'shot'],
  ground: ['player', 'enemy', 'shot'],
  shot: ['ground', 'enemy'],
  enemy: ['player', 'ground', 'shot'],
};
const SHAPE: Record<Group, string> = { player: 'person', ground: 'floor', shot: 'bullet', enemy: 'person' };
const USE: Record<Group, Use> = { player: use('player', 'person'), ground: use('ground', 'floor'), shot: use('shot', 'bullet'), enemy: use('enemy', 'person') };

function teams(collides: Partial<Record<Group, Group[]>> = {}, member: Partial<Record<Group, Group[]>> = {}): JsonObject {
  const shapeUse = (g: Group): JsonObject => ({ shape: SHAPE[g], member: member[g] ?? [g], collides: collides[g] ?? COLLIDES[g] });
  return world({
    collision_groups: [...GROUPS],
    shapes: { person: { kind: 'box', half: [0.3, 0.9, 0.3] }, floor: { kind: 'box', half: [10, 0.1, 10] }, bullet: { kind: 'sphere', radius: 0.05 } },
    bodies: {
      player: { kind: 'dynamic', mass: 80, pose: { pos: [0, 0.9, 0] }, shapes: [shapeUse('player')] },
      ground: { kind: 'static', pose: { pos: [0, -0.1, 0] }, shapes: [shapeUse('ground')] },
      shot: { kind: 'dynamic', mass: 0.01, gravity_scale: 0, pose: { pos: [0, 1, 2] }, shapes: [shapeUse('shot')] },
      enemy: { kind: 'dynamic', mass: 80, pose: { pos: [4, 0.9, 0] }, shapes: [shapeUse('enemy')] },
    },
  });
}

/** Two groups interact when each one's shape `collides` names the other's group (one shape use per group here). */
const interacts = (a: Group, b: Group): boolean => a !== b && COLLIDES[a].includes(b) && COLLIDES[b].includes(a);

/** A FAIL with exactly one failure: the lock on (a, b), naming both shapes. */
function oneBrokenLock(p: Pairs, lock: 'touch' | 'never', a: Group, b: Group): string[] {
  const f: string[] = [];
  if (p.verdict !== 'FAIL') f.push(`the verdict is ${show(p.verdict)}, not FAIL`);
  if (p.failures.length !== 1) f.push(`physics.pairs reports ${p.failures.length} failures, not the one broken lock: ${show(p.failures)}`);
  if (failuresNaming(p, USE[a], USE[b], lock, [a, b]).length !== 1) {
    f.push(`no failure names the ${lock} lock on ${a}–${b} with both shapes (${a}/shapes/0 and ${b}/shapes/0): ${show(p.failures)}`);
  }
  return f;
}

describe(`${CRITERIA[1]} physics.pairs holds the brief's locked pairs over the interaction matrix`, () => {
  it(`${CRITERIA[1]} the world meeting player–ground, shot–enemy touch and shot–player never passes with its 10 group pairs; ground omitting player fails naming player–ground and both shapes; shot naming player fails naming shot–player`, () => {
    const [good, noGround, shotHitsOwner] = ask([
      pairsCall(teams(), BRIEF),
      pairsCall(teams({ ground: ['enemy', 'shot'] }), BRIEF),
      pairsCall(teams({ shot: ['ground', 'enemy', 'player'] }), BRIEF),
    ]);

    const p = pairsOf(good!, 'the world meeting the brief');
    expect(p.groups, 'physics.pairs reads the world\'s four groups').toEqual([...GROUPS]);
    none(matrixFailures(p, GROUPS, (a, b) => interacts(a as Group, b as Group)), 'the matrix holds its 10 group pairs, each interacting only when both sides\' collides name the other');
    expect(p.verdict, `the world meeting all three locks passes: ${show(p.failures)}`).toBe('PASS');
    expect(p.failures, 'a PASS lists no failure').toEqual([]);

    const q = pairsOf(noGround!, 'ground\'s collides omits player');
    none(matrixFailures(q, GROUPS, (a, b) => !(isPair(a, b, 'player', 'ground')) && interacts(a as Group, b as Group)), 'its matrix has player–ground not interacting, the rest unchanged');
    none(oneBrokenLock(q, 'touch', 'player', 'ground'), 'ground\'s collides omitting player, while player\'s names ground, fails naming player–ground and both shapes');

    const r = pairsOf(shotHitsOwner!, 'shot\'s collides names player');
    none(oneBrokenLock(r, 'never', 'shot', 'player'), 'shot\'s collides naming player fails naming shot–player');
  }, TIMEOUT);

  it(`${CRITERIA[1]} a shape whose member is empty is refused, naming it`, () => {
    const [reply] = ask([pairsCall(teams({}, { enemy: [] }), BRIEF)]);
    expect(reply!['verdict'], 'a world with a shape in no group is refused, never judged').not.toBe('PASS');
    expect(reply!['ok'], `physics.pairs refuses the world (ok: false with its issues): ${show(reply)}`).toBe(false);
    const issues = arr(reply!['issues'], 'the refusal\'s issues').map((v, i) => obj(v, `the refusal's issues[${i}]`));
    const naming = issues.filter((i) => i['severity'] === 'error' && typeof i['path'] === 'string'
      && /^\/?bodies[/.]enemy[/.]shapes[/.]0([/.]|$)/.test(i['path']) && (!Array.isArray(i['ids']) || i['ids'].includes('enemy')));
    expect(naming.length, `an error issue names enemy's shape use (its path is bodies/enemy/shapes/0 or under it): ${show(issues)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});

function isPair(a: string, b: string, x: string, y: string): boolean {
  return (a === x && b === y) || (a === y && b === x);
}
