// AC5 #149.75d75ba2: Seeking to any time equals playing to it by pixel hash for every field, and no field reseeds with
// playback.
//
// Every family's fixture covers its fields; the paper and noise fixtures run once more for each tooth kind and noise
// kind the issue lists. Each is played from frame 0 and held to:
//   - a second play, in a fresh process, equal frame by frame (no field reads a clock or a session);
//   - a play opened part way through, with nothing drawn before it, equal from there on;
//   - frames sought alone in a fresh process, equal to the played frame;
//   - the same times reached at twice the frame rate, so a seed keyed by a frame count rather than by time is caught.
// Its frames must differ, so the film moved. Nothing here reads a picture.
//
// Wrong programs: a seed from frames drawn, from the clock, or from a frame index at a given rate; a field that keeps
// state from the frame before.
import { describe, expect, it } from 'vitest';
import {
  AC, FAMILIES, FAMILY_SIZE, clone, familyFixture, film2dCall, lookOf, none, obj, requireMetal, rows, runGpu, useDir, useGpu, view3dCall, writeJson, type Dim, type JsonObject, type Row,
} from './helpers.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const FPS = 15;
const FRAMES = 31; // 2 s
const MID = 10;
const SOUGHT = [7, 19, 30];

interface Case { name: string; doc: JsonObject; look: JsonObject }
const TOOTH = ['cold_press', 'laid', 'wove', 'canvas', 'linen', 'silk', 'stone', 'wood'];
const NOISE = ['fractal', 'turbulent', 'cells', 'value'];

function cases(dim: Dim): Case[] {
  const all: Case[] = FAMILIES.map((f) => { const x = familyFixture(f); return { name: `${f} ${dim}`, doc: obj(x[dim], dim), look: lookOf(x) }; });
  if (dim === '3d') return all;
  const paper = familyFixture('paper');
  for (const kind of TOOTH) {
    const look = clone(lookOf(paper));
    obj(obj(obj(look['ground'], 'ground')['params'], 'params')['tooth'], 'tooth')['kind'] = kind;
    all.push({ name: `tooth ${kind}`, doc: obj(paper['2d'], '2d'), look });
  }
  const noise = familyFixture('noise');
  for (const kind of NOISE) {
    const doc = clone(obj(noise['2d'], '2d'));
    const sky = obj(obj(doc['items'], 'items')['sky'], 'sky');
    obj(obj(obj(obj(sky['params'], 'params')['paint'], 'paint')['fill'], 'fill')['noise'], 'noise')['kind'] = kind;
    all.push({ name: `noise ${kind}`, doc, look: lookOf(noise) });
  }
  return all;
}
function play(c: Case, dim: Dim, extra: JsonObject): Row[] {
  const out = dir();
  const call = dim === '2d'
    ? film2dCall(c.doc, c.look, extra)
    : view3dCall(writeJson(out, 'film.json', c.doc), c.look, FAMILY_SIZE, { capture: 'every', targets: ['final'], ...extra });
  return rows(runGpu(bin(), out, [call])[0]!, `${c.name} ${JSON.stringify(extra)}`);
}
function problems(c: Case, dim: Dim): string[] {
  const failures: string[] = [];
  const played = new Map(play(c, dim, { fps: FPS, frames: FRAMES }).map((r) => [r.frame, r.hash]));
  expect(played.size, `${c.name}: the film plays ${FRAMES} frames`).toBe(FRAMES);
  expect(new Set(played.values()).size, `${c.name}: the film moves`).toBeGreaterThan(1);
  const hold = (how: string, n: number, hash: string | undefined): void => { if (hash !== played.get(n)) failures.push(`${c.name}: ${how} frame ${n}: ${hash} against the played ${played.get(n)!}`); };
  for (const r of play(c, dim, { fps: FPS, frames: FRAMES })) hold('a second play at', r.frame, r.hash);
  for (const r of play(c, dim, { fps: FPS, from: MID, frames: FRAMES - MID })) hold(`a play opened at ${MID}, at`, r.frame, r.hash);
  for (const n of SOUGHT) {
    hold('sought to', n, play(c, dim, { fps: FPS, from: n, frames: 1 })[0]?.hash);
    hold('the same time at twice the rate,', n, play(c, dim, { fps: 2 * FPS, from: 2 * n, frames: 1 })[0]?.hash);
  }
  return failures;
}

describe(`${ID} seek equals play for every field`, () => {
  it(`${ID} in 2D and 3D: every family, tooth and noise kind seeks equal to play by pixel hash, and no field reseeds with playback`, () => {
    requireMetal();
    none((['2d', '3d'] as Dim[]).flatMap((dim) => cases(dim).flatMap((c) => problems(c, dim))), 'frames that depend on how they were reached');
  });
});
