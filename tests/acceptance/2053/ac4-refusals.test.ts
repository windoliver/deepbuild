// AC4 #2053.07ff75d0: "A 32 × 32 page on the 64 × 64 image is refused at check, and the refusal names both sizes. A light
// with `height: 0` is refused, naming the light. An image with a `normal` in a group with no `light` draws a frame
// byte-identical to the same image without the page and raises one notice naming the image. A planted check that accepts
// the smaller page and stretches it fails"
//
// Through `deep-canvas-render check {doc, look, store, planted?}` (every platform) and `window2d` (Metal, with the
// store). Each document is AC1's: the white 64 × 64 image `wall` in the group `lamps`, the light `UP`:
//   - `fits`: a 64 × 64 page of texels (128, 204) and height 100: accepted, with no error at all (so a check that refuses
//     every page, every `normal` or every `height` fails here);
//   - `small`: a 32 × 32 page of the same texels: refused by an error that names both sizes, 64 × 64 and 32 × 32
//     (README: Readings, "Names both sizes");
//   - `flat`: the light's `height: 0`: refused by an error naming the light, `items/lamps/params/light/lights/0` or a path
//     under it (such as `…/height`), or whose `ids` hold that path;
//   - `unlit`: the 64 × 64 page, `lamps` a group with no `light`: accepted with no error, and the page adds exactly one
//     notice naming `wall` (its `ids` hold it, or its `path` is under `items/wall`) to those the same document without
//     the page raises, matched by code and path; the same page in the lit `fits` adds none. (At the base `check` raises
//     `unknown_kind` on every `image@1`, page or no page, so the notices are counted as what the page adds.) Its frame,
//     beside the same document with no `normal`, is byte-identical (the same SHA-256 of the window's PNG), and its
//     centre pixel shows the white image over an `accent` backdrop, so the frame shows the image it compares.
// The planted check is `"planted": "normal_accepts_smaller_page"` in the `check` line: the check must take the name
// (not `bad_input`), and the small page's judgement must fail on its answer.
// Wrong programs: the base (`check` skips `image@1` and reads no `height`, so nothing is refused or noticed; the frame
// calls take no store), a page stretched to its image, a height of 0 let through, a notice raised for every page or for
// none, a page outside a lit group read anyway.
import { describe, expect, it } from 'vitest';
import {
  AC, checked, doc, errorsOf, issuesOf, item, LEANING, litWall, MID, offBy, px, requireMetal, SIZE, storeIn, uniformPage, UP, useBin,
  useDir, wall, whiteImage, windows, arr, obj, shown, type Issue, type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = AC[4];
const canvas = useBin('deep-canvas-render');
const gpu = useBin('deep-gpu');
const dir = useDir();
const LIGHT_PATH = 'items/lamps/params/light/lights/0';

/** The documents, their PNGs in a fresh store. */
function docs(): { store: string; fits: JsonObject; litBare: JsonObject; small: JsonObject; flat: JsonObject; unlit: JsonObject; bare: JsonObject } {
  const store = storeIn(dir());
  const asset = whiteImage(store, 64, 64);
  const page = uniformPage(store, 64, 64, LEANING).hash;
  const smaller = uniformPage(store, 32, 32, LEANING).hash;
  const unlitDoc = (id: string, normal?: string): JsonObject => doc(id, SIZE, [
    item('backdrop', 'rect@1', 'a0', { box: [96, 96, 128, 128], paint: { fill: { role: 'accent' } } }),
    item('lamps', 'group@1', 'a1', {}),
    wall(asset, 'lamps', { order: 'a2', ...(normal ? { normal } : {}) }),
  ]);
  return {
    store,
    fits: litWall('page-fits', asset, [UP], { normal: page }),
    litBare: litWall('page-bare-lit', asset, [UP]),
    small: litWall('page-small', asset, [UP], { normal: smaller }),
    flat: litWall('height-none', asset, [{ ...UP, height: 0 }], { normal: page }),
    unlit: unlitDoc('page-unlit', page),
    bare: unlitDoc('page-bare'),
  };
}
const errors = (answer: JsonObject, what: string): Issue[] => errorsOf(issuesOf(answer, what));
const shownErrors = (e: Issue[]): string => e.map((i) => shown(i.raw)).join('; ') || 'none';
/** Whether a value names the size w × h: as text (`64 × 64`, `64x64`, `64 x 64`), as `[w, h]`, or as `{width, height}`. */
function namesSize(v: JsonValue | undefined, [w, h]: [number, number]): boolean {
  if (typeof v === 'string') return [`${w} × ${h}`, `${w}×${h}`, `${w}x${h}`, `${w} x ${h}`].some((t) => v.includes(t));
  if (Array.isArray(v)) return (v.length === 2 && v[0] === w && v[1] === h) || v.some((x) => namesSize(x, [w, h]));
  if (v !== null && typeof v === 'object') return (v['width'] === w && v['height'] === h) || Object.values(v).some((x) => namesSize(x, [w, h]));
  return false;
}
/** The small page's judgement: refused, by an error naming both sizes. */
function smallFailures(answer: JsonObject): string[] {
  const e = errors(answer, 'check of page-small');
  const failures: string[] = [];
  if (answer['ok'] !== false) failures.push(`a 32 × 32 page on the 64 × 64 image: the check answers ok ${shown(answer['ok'])}, not a refusal`);
  if (!e.some((i) => namesSize(i.raw, [64, 64]) && namesSize(i.raw, [32, 32]))) failures.push(`a 32 × 32 page on the 64 × 64 image: no error names both sizes; errors: ${shownErrors(e)}`);
  return failures;
}
const namesItem = (n: JsonObject, id: string): boolean => {
  const path = typeof n['path'] === 'string' ? n['path'] : '';
  return (Array.isArray(n['ids']) && n['ids'].includes(id)) || path === `items/${id}` || path.startsWith(`items/${id}/`);
};
const noticesNaming = (answer: JsonObject, id: string, what: string): JsonObject[] =>
  arr(answer['notices'] ?? [], `${what}: notices`).map((n, i) => obj(n, `${what}: notices[${i}]`)).filter((n) => namesItem(n, id));
/**
 * The notices naming `wall` that the paged document raises and the same document without the page doesn't, matched
 * by code and path, one for one: what the page adds (README: Readings, "Raises one notice naming the image").
 */
function added(paged: JsonObject, bare: JsonObject, what: string): JsonObject[] {
  const left = noticesNaming(bare, 'wall', `${what} without the page`).map((n) => `${String(n['code'])} ${String(n['path'])}`);
  return noticesNaming(paged, 'wall', what).filter((n) => {
    const k = left.indexOf(`${String(n['code'])} ${String(n['path'])}`);
    if (k < 0) return true;
    left.splice(k, 1);
    return false;
  });
}

describe(`${ID} the check refuses a page of another size and a height of 0; a page outside a lit group draws as today`, () => {
  it(`${ID} a 32 × 32 page is refused naming both sizes, and a light with height 0 is refused naming the light`, () => {
    const d = docs();
    const fits = checked(canvas(), d.fits, d.store);
    expect(errors(fits, 'check of page-fits'), `a 64 × 64 page on the 64 × 64 image, under a light of height 100, is accepted: ${shownErrors(errors(fits, 'page-fits'))}`).toEqual([]);
    const flat = errors(checked(canvas(), d.flat, d.store), 'check of height-none');
    const failures = [
      ...smallFailures(checked(canvas(), d.small, d.store)),
      ...(flat.some((e) => e.path === LIGHT_PATH || e.path.startsWith(`${LIGHT_PATH}/`) || e.ids.includes(LIGHT_PATH)) ? [] : [`a light with height 0: no error names the light ${LIGHT_PATH}; errors: ${shownErrors(flat)}`]),
    ];
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it(`${ID} an image with a normal in a group with no light raises one notice naming the image, and none in a lit group`, () => {
    const d = docs();
    const [unlit, bare, lit, litBare] = [d.unlit, d.bare, d.fits, d.litBare].map((x) => checked(canvas(), x, d.store));
    console.log(`${ID}: notices naming wall outside a lit group with the page: ${shown(noticesNaming(unlit!, 'wall', 'page-unlit'))}; without: ${shown(noticesNaming(bare!, 'wall', 'page-bare'))}`);
    expect(errors(unlit!, 'check of page-unlit'), 'the page outside a lit group is accepted').toEqual([]);
    expect(added(unlit!, bare!, 'page-unlit').length, `the page outside a lit group adds one notice naming wall; notices: ${shown(unlit!['notices'])}`).toBe(1);
    expect(added(lit!, litBare!, 'page-fits'), 'the same page in a lit group adds no notice naming wall').toEqual([]);
  });

  it(`${ID} an image with a normal in a group with no light draws a frame byte-identical to the same image without the page`, () => {
    requireMetal();
    const d = docs();
    const [paged, bare] = windows(gpu(), dir(), d.store, [d.unlit, d.bare]);
    console.log(`${ID}: window ${paged!.hash.slice(0, 16)} with the page, ${bare!.hash.slice(0, 16)} without; centre ${px(paged!.image, ...MID).join(', ')}`);
    expect(offBy(bare!.image, ...MID, 255), `the frame shows the white image at its centre pixel (${MID.join(', ')}), over the accent backdrop: ${px(bare!.image, ...MID).join(', ')}`).toBe(0);
    expect(paged!.hash, 'the frame with the page outside a lit group is byte-identical to the frame without it').toBe(bare!.hash);
  });

  it(`${ID} a planted check that accepts the smaller page fails`, () => {
    const d = docs();
    const failures = smallFailures(checked(canvas(), d.small, d.store, 'normal_accepts_smaller_page'));
    console.log(`${ID}: under normal_accepts_smaller_page: ${failures.join('; ') || 'no failure'}`);
    expect(failures.length, 'the planted check that accepts the 32 × 32 page fails the judgement of the small page').toBeGreaterThan(0);
  });
});
