// #418.5b97c661 Wherever status can show, a grade that would move any palette role a 3D writer layer uses within the
// look's status distance is refused naming the role, and status colors, legends and 2D marks are never graded.
//
// #382's film, its lamp's badge bound to a failed verdict (so status can show), with a 2D writer layer's marker dot
// anchored to the lamp (#378's overlay), drawn in a headless window. Roles: lamp #d9a441, block #b8bcc4, crate
// #7fa7c9, floor #2a2d33 (the 3D layer's) and marker #f0f0f0 (the 2D layer's), each at least 0.12 OKLab from every
// status color. The refused grade is the CDL whose slope takes the lamp exactly onto the fail color (offset 0,
// power 1, saturation 1); its refusal must name a role this suite finds within 0.10 of a status color once graded
// (the lamp is one). The same grade on the film played alone (no binding) is accepted: status can't show there. The
// accepted grade (slope [0.85, 1, 1.15]) keeps every graded role 0.11 or more from every status color; with it the
// fail mark and the legend draw the fail color exactly, the marker draws its role exactly in the window, and the
// lamp is graded (its face's most common pixel is this suite's CDL of the ungraded face's, within one code value).
// At the base `view3d` reads no `grade`: nothing is refused and the lamp isn't graded.
import { describe, expect, it } from 'vitest';
import {
  FAIL, FAILED, STATES, STATUS, answered, cdl, decode8, deltaELin, film, frameAt, fromHex, hex, look, mode, pixel, readIds, readPng, requireGpu, run, shown,
  srgbEncode, statusExact, statusOf, useGpuBin, useOut, writeJson, type Cdl, type Image, type JsonObject, type Lin, type Rgb,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const SIZE: [number, number] = [480, 360];
const ROLES: Record<string, Rgb> = { lamp: fromHex('#d9a441'), block: fromHex('#b8bcc4'), crate: fromHex('#7fa7c9'), floor: fromHex('#2a2d33'), marker: fromHex('#f0f0f0') };
const LAYER_3D = ['lamp', 'block', 'crate', 'floor'];
const nearestStatus = (c: Lin): number => Math.min(...STATES.map((s) => deltaELin(c, decode8(fromHex(STATUS[s])))));
const failLin = decode8(FAIL); const lampLin = decode8(ROLES['lamp']!);
const REFUSED: Cdl = { slope: [0, 1, 2].map((i) => failLin[i]! / lampLin[i]!) as Lin, offset: [0, 0, 0], power: [1, 1, 1], saturation: 1 };
const ACCEPTED: Cdl = { slope: [0.85, 1, 1.15], offset: [0, 0, 0], power: [1, 1, 1], saturation: 1 };
const asGrade = (g: Cdl): JsonObject => ({ white_balance: { temperature: 6500, tint: 0 }, slope: g.slope, offset: g.offset, power: g.power, saturation: g.saturation });
const count = (img: Image, c: Rgb): number => { let n = 0; for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (pixel(img, x, y).join() === c.join()) n++; return n; };

describe('#418.5b97c661 a grade that moves a role into the status distance is refused, and status, legends and 2D marks are never graded', () => {
  it('#418.5b97c661 with status showing, a grade taking the lamp onto the fail color is refused naming a role it moves within 0.10; played alone it is accepted; an accepted grade grades the lamp but not the fail mark, the legend or the 2D marker', () => {
    // The fixture first holds what the test needs, by this suite's OKLab math.
    for (const [r, c] of Object.entries(ROLES)) expect(nearestStatus(decode8(c)), `${r} sits 0.12 or more from every status color`).toBeGreaterThanOrEqual(0.12);
    const clashing = LAYER_3D.filter((r) => nearestStatus(cdl(decode8(ROLES[r]!), REFUSED)) < 0.1);
    expect(clashing, 'the refused grade moves the lamp within 0.10 of a status color').toContain('lamp');
    for (const r of LAYER_3D) expect(nearestStatus(cdl(decode8(ROLES[r]!), ACCEPTED)), `the accepted grade keeps ${r} 0.11 or more from every status color`).toBeGreaterThanOrEqual(0.11);

    requireGpu();
    const bound = writeJson(out(), 'film-bound.json', film('film-grade-418', { binding: true, marker: true }));
    const alone = writeJson(out(), 'film-alone.json', film('film-grade-alone-418', { marker: true }));
    const call = (doc: string, grade: Cdl | null): JsonObject => ({
      call: 'view3d', doc, look: look('grade-418', ROLES, grade ? { grade: asGrade(grade) } : {}), size: SIZE, states: FAILED,
      targets: ['final', 'ids'], capture: [0], window: { size: SIZE, view: [0, 0], page: [255, 255, 255] },
    });
    const [refused, played, graded, plain] = run(gpu.bin(), out(), [call(bound, REFUSED), call(alone, REFUSED), call(bound, ACCEPTED), call(bound, null)]);

    expect(refused!['code'], `with status showing, the grade is refused with the look's status_distance: ${shown(refused)}`).toBe('status_distance');
    expect(clashing, `the refusal names a 3D layer's role the grade moves within the distance (${clashing.join(', ')}), not ${shown(refused!['role'])}`).toContain(refused!['role']);
    answered(played!, 'the same grade on the film played alone, where status can\'t show');

    const g = frameAt(answered(graded!, 'the accepted grade'), 0, 'the accepted grade');
    const p = frameAt(answered(plain!, 'no grade'), 0, 'no grade');
    const gFinal = readPng(out(), g, 'final', 'the accepted grade'); const pFinal = readPng(out(), p, 'final', 'no grade');
    expect(statusExact(statusOf(graded!, 'the accepted grade'), gFinal, FAIL, 'the accepted grade')).toEqual([]);

    // The 2D marker draws its role exactly in the window, graded or not.
    const marker = ROLES['marker']!;
    const gMarker = count(readPng(out(), g, 'window', 'the accepted grade'), marker); const pMarker = count(readPng(out(), p, 'window', 'no grade'), marker);
    expect(pMarker, `the marker draws ${hex(marker)} in the window without a grade`).toBeGreaterThanOrEqual(20);
    expect(Math.abs(gMarker - pMarker), `the graded frame's window holds the marker's ${hex(marker)} pixels as the ungraded one does (${gMarker} against ${pMarker})`).toBeLessThanOrEqual(2);

    // The lamp is graded: its face is this suite's CDL of the ungraded face, within one code value.
    const onLamp = (f: typeof g, what: string) => { const ids = readIds(out(), f, what); return (x: number, y: number) => ids.at(x, y) === 'lamp'; };
    const before = mode(pFinal, onLamp(p, 'no grade')).color; const after = mode(gFinal, onLamp(g, 'the accepted grade')).color;
    const want = cdl(decode8(before), ACCEPTED).map((v) => Math.round(255 * srgbEncode(v))) as Rgb;
    expect(Math.max(...[0, 1, 2].map((c) => Math.abs(after[c]! - want[c]!))), `the lamp's face is graded: ${hex(before)} → ${hex(after)}, the CDL gives ${hex(want)}`).toBeLessThanOrEqual(1);
    expect(Math.max(...[0, 1, 2].map((c) => Math.abs(after[c]! - before[c]!))), 'the grade moves the lamp\'s face visibly').toBeGreaterThanOrEqual(3);
  }, 1_800_000);
});
