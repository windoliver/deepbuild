// The contrast ratio of the pinned upstream accessibility library's tests (README: Sources), run against our output
// (#136: a linked test counts only when run against our output). The oracle page's use is "port": the library's tests
// hold the WCAG 2 contrast ratio and its 4.5:1 floor for normal text, the rule behind the planted text-under-4.5:1
// fault. No upstream code runs here and none is copied: the ratio is re-expressed below from the WCAG 2 definitions,
// and its self-checks are values of that definition (black on white is 21:1, a colour on itself 1:1, and the two greys
// either side of 4.5:1 on white).
//
//   - Relative luminance: each sRGB channel c of 0..1 is c ÷ 12.92 at or below 0.03928, else ((c + 0.055) ÷ 1.055)^2.4;
//     L = 0.2126 R + 0.7152 G + 0.0722 B.
//   - Contrast ratio: (L_lighter + 0.05) ÷ (L_darker + 0.05); normal text needs at least 4.5.
//   - Ours: the #1938 contrast pair (../1938/helpers.ts `contrastPair`), a 48 px caption on the ground of the shipped
//     clean look, light theme, in the `muted` role (planted) and the `ink` role (twin). The roles' colours are read from
//     the look as the binary ships it (crates/deep-canvas-marks/looks/clean.json). By the formula the planted caption is
//     under 4.5:1 and the twin over it; render.contrast must fail the first, naming the caption and the ratio it
//     measured, within 0.1 of the formula's, and pass the second.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAPTION, REPO, ROLES, TIMEOUT, brief, contrastPair, isObject, judgePair, matching, none, passFailures, proof, useBuild, useFolders,
  type Issue, type JsonObject, type JsonValue,
} from './helpers.ts';

/** Criterion 1's ID, the one the oracle page links this source to. */
const ID = '#1938.f19b61dd';
const bin = useBuild();
const folder = useFolders();

/** WCAG 2's relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}
/** WCAG 2's contrast ratio of two colours, lighter over darker, each plus 0.05. */
function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** Normal text's floor. */
const MIN = 4.5;

/** The port's own self-checks: why the formula above isn't WCAG 2's. */
function portFailures(): string[] {
  const f: string[] = [];
  const near = (what: string, got: number, want: number, tol: number): void => { if (!(Math.abs(got - want) <= tol)) f.push(`${what} is ${got}, not ${want}`); };
  near('black on white', ratio('#000000', '#ffffff'), 21, 1e-9);
  near('white on white', ratio('#ffffff', '#ffffff'), 1, 1e-12);
  near('the ratio taken either way round', ratio('#ffffff', '#336699') - ratio('#336699', '#ffffff'), 0, 1e-12);
  if (!(ratio('#767676', '#ffffff') >= MIN)) f.push(`#767676 on white is ${ratio('#767676', '#ffffff')}, which normal text's 4.5:1 should pass`);
  if (!(ratio('#777777', '#ffffff') < MIN)) f.push(`#777777 on white is ${ratio('#777777', '#ffffff')}, which normal text's 4.5:1 should fail`);
  return f;
}

/** A role's colour in the shipped clean look's light theme: the role's palette name, or a colour given directly. */
function roleHex(look: JsonObject, role: string): string {
  const roles = isObject(look['roles']) ? look['roles'] : {};
  const palette = isObject(look['palette']) ? look['palette'] : {};
  const light = isObject(look['themes']) && isObject(look['themes']['light']) && isObject(look['themes']['light']['roles']) ? look['themes']['light']['roles'] : {};
  const named = (light[role] ?? roles[role]) as JsonValue | undefined;
  const hex = typeof named === 'string' ? (named.startsWith('#') ? named : palette[named]) : undefined;
  expect(typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex), `the clean look gives role ${role} an opaque colour: ${brief(named)} → ${brief(hex)}`).toBe(true);
  return (hex as string).toLowerCase();
}

/** The measured ratio a render.contrast failure names: its `ratio`, its `actual.ratio`, or `actual` itself. */
function measured(i: Issue): number | undefined {
  const actual = i.raw['actual'];
  const v = i.raw['ratio'] ?? (isObject(actual) ? actual['ratio'] : actual);
  return typeof v === 'number' ? v : undefined;
}

describe(`${ID} the upstream accessibility library's contrast ratio, run against render.contrast`, () => {
  it(`${ID} render.contrast fails the caption under 4.5:1 by the WCAG 2 ratio, naming the ratio it measured, and passes the caption over it`, () => {
    none(portFailures(), 'the port is WCAG 2\'s contrast ratio');
    const look = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
    const ground = roleHex(look, ROLES.ground);
    const [low, high] = [ratio(roleHex(look, ROLES.planted), ground), ratio(roleHex(look, ROLES.twin), ground)];
    expect(low, `the planted caption (${ROLES.planted} on ${ROLES.ground}) is under 4.5:1 by the formula`).toBeLessThan(MIN);
    expect(high, `the twin caption (${ROLES.twin} on ${ROLES.ground}) is at least 4.5:1 by the formula`).toBeGreaterThanOrEqual(MIN);

    const pair = contrastPair();
    const judged = judgePair(bin(), folder(), pair);
    proof('render.contrast against the formula', { formula: { planted: low, twin: high }, planted: judged.planted.raw, twin: judged.twin.raw });
    expect(judged.planted.result, `render.contrast on the caption in ${ROLES.planted}: ${brief(judged.planted.raw)}`).toBe('FAIL');
    const found = matching(judged.planted, pair.fault);
    const ratios = found.map(measured).filter((v): v is number => v !== undefined);
    expect(ratios.length, `render.contrast's failure naming ${CAPTION} names the ratio it measured: ${found.map((i) => brief(i.raw, 600)).join('; ') || 'no such failure'}`).toBeGreaterThan(0);
    expect(ratios.some((v) => Math.abs(v - low) <= 0.1), `render.contrast measured ${ratios.join(', ')} for the caption, where the WCAG 2 ratio of its colours is ${low.toFixed(4)}`).toBe(true);
    none(passFailures(judged.twin, `render.contrast on the caption in ${ROLES.twin}, ${high.toFixed(2)}:1 by the formula`), 'the caption over 4.5:1 passes');
  }, TIMEOUT);
});
