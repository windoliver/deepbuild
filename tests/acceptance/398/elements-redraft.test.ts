// #398, criterion 6: "An SVG with a `<clipPath>`, a `<mask>`, a `<pattern>` fill, a `<marker>` and a `<style>`
// block imports with each drawn as listed or named in an issue, and a `rect` with rx 4 imports with rounded corners
// within 0.01 u; a planted importer that skips `<clipPath>` without an issue fails, naming the element."
//
// Scope: "The import reads a closed list of elements and attributes: each element outside it, such as clipPath, mask,
// pattern, marker, switch or a style block, is drawn as listed or returned as an issue naming it, never dropped
// without one." Oracle page: resvg 77b12f4951's masking/clipPath, masking/mask, paint-servers/pattern,
// painting/marker, structure/style and shapes/rect, run on our code: each pair drawn to its PNG through our import or
// named in an issue (README: What each test holds).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIXTURES, PLANTED, check, codeDistance, decodePng, drawn, geometryParts, issuesNaming, perceptual, pixel, plantedMismatches,
  raster, roundedRectBoundary, roundedRectDistance, sample, scratch, sha256, useRenderBinary, vectorDoc,
  type Checked, type Image, type JsonObject, type Rgb, type VectorDoc,
} from './elements-helpers.ts';

useRenderBinary();
const dir = scratch('elements');

const ELEMENTS = ['clipPath', 'mask', 'pattern', 'marker', 'style'] as const;
type Tag = (typeof ELEMENTS)[number];

const GROUND: Rgb = [255, 255, 255];
/** A probe 3 px or more inside a region whose color is flat in every renderer reads within 2 code values of it. */
const CODES = 2;

// ---------------------------------------------------------------------------------------------------
// The hand-written SVG (fixtures/elements/elements.svg): one region per element, its viewBox 240 × 160 drawn at
// scale 1 onto [16, 16, 240, 160] in a 272 × 192 board, so a point (x, y) of the SVG is (x + 16, y + 16) in u.

const POS: [number, number] = [16, 16];
const ELEMENTS_SVG = readFileSync(join(FIXTURES, 'elements', 'elements.svg'));
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

/**
 * Where each element shows, in SVG units, from SVG's own rules (README: The hand-written SVG): `inside` probes read the
 * element's color, `ground` probes read the white ground. Every probe is at least 3 units from any edge.
 */
const PROBES: Record<Tag, { color: Rgb; inside: [number, number][]; ground: [number, number][]; rule: string }> = {
  clipPath: {
    color: hex('#1e7b34'), inside: [[30, 30], [23, 37]], ground: [[15, 15], [60, 60], [30, 55], [55, 30], [45, 45]],
    rule: 'the rect 10..70 is clipped to the clip path\'s rect 20..40',
  },
  mask: {
    color: hex('#2050c0'), inside: [[105, 40], [95, 15], [115, 65]], ground: [[135, 40], [145, 65], [125, 15]],
    rule: 'the rect 90..150 is masked by white over 90..120 and black over 120..150',
  },
  pattern: {
    color: hex('#c03020'), inside: [[185, 25], [205, 25], [185, 45], [205, 45]], ground: [[195, 25], [185, 35], [195, 35], [215, 55], [215, 45], [205, 35]],
    rule: 'the rect 180..220 × 20..60 is filled by 20-unit tiles whose top-left 10 × 10 is the pattern\'s color, tiled from (0, 0)',
  },
  marker: {
    color: hex('#7a2a90'), inside: [[83, 117], [77, 124], [84, 124], [77, 116]], ground: [[90, 120], [80, 110], [80, 130], [92, 112]],
    rule: 'the line ends at (80, 120), where the marker\'s 12 × 12 rect is placed by refX 6, refY 6 in user space, unturned',
  },
  style: {
    color: hex('#208080'), inside: [[160, 120], [150, 105], [175, 135]], ground: [[135, 120], [185, 120]],
    rule: 'the style block\'s `.tinted { fill: #208080 }` overrides the rect\'s fill attribute #e0a000',
  },
};

function elementsDoc(): VectorDoc {
  return vectorDoc(dir, ELEMENTS_SVG, { id: 'v398-elements', title: 'Five elements', alt: 'clipPath, mask, pattern, marker and style', docSize: [272, 192], pos: POS, size: [240, 160] });
}

interface Run { checked: Checked; report: JsonObject; image: Image | null }
function run(planted?: string): Run {
  const v = elementsDoc();
  const checked = check(v, planted);
  const { report, image } = raster(dir, v, planted);
  return { checked, report, image };
}
let clean: Run | null = null;
const cleanRun = (): Run => (clean ??= run());

/**
 * Whether each element is drawn as listed or named in an issue: [] when it is, else sentences that name it. An
 * element named in an issue of `check` (any severity) is accounted for; otherwise the raster must have drawn it and
 * every probe of its region must read as SVG draws it.
 */
function account(r: Run): Record<Tag, string[]> {
  const out = {} as Record<Tag, string[]>;
  for (const tag of ELEMENTS) {
    if (issuesNaming(r.checked, tag).length > 0) { out[tag] = []; continue; }
    if (!r.image) {
      out[tag] = [`<${tag}> is neither drawn nor named in an issue: the raster drew nothing (${JSON.stringify(r.report).slice(0, 600)}) and no issue of the check names ${tag}`];
      continue;
    }
    const p = PROBES[tag];
    const problems: string[] = [];
    for (const [x, y] of p.inside) {
      const got = pixel(r.image, x + POS[0], y + POS[1]);
      if (codeDistance(got, p.color) > CODES) problems.push(`<${tag}> is neither drawn as listed nor named in an issue: at (${x}, ${y}) of the SVG the import draws ${JSON.stringify(got)}, where SVG draws ${JSON.stringify(p.color)} (${p.rule})`);
    }
    for (const [x, y] of p.ground) {
      const got = pixel(r.image, x + POS[0], y + POS[1]);
      if (codeDistance(got, GROUND) > CODES) problems.push(`<${tag}> is neither drawn as listed nor named in an issue: at (${x}, ${y}) of the SVG the import draws ${JSON.stringify(got)}, where SVG leaves the ground ${JSON.stringify(GROUND)} (${p.rule})`);
    }
    out[tag] = problems;
  }
  return out;
}

describe('#398 AC6 an SVG with a clipPath, a mask, a pattern fill, a marker and a style block imports with each drawn as listed or named in an issue', () => {
  it('AC6 the SVG imports: the raster draws it, and draws something', () => {
    const r = cleanRun();
    expect(r.report['ok'], `the SVG with the five elements imports and draws: ${JSON.stringify(r.report).slice(0, 2000)}; check: ${JSON.stringify(r.checked.raw).slice(0, 2000)}`).toBe(true);
    let ink = 0;
    for (let y = 0; y < r.image!.height; y++) for (let x = 0; x < r.image!.width; x++) if (codeDistance(pixel(r.image!, x, y), GROUND) > CODES) ink++;
    expect(ink, 'the imported SVG draws some of its shapes (the line and the styled rect draw whatever else is named in an issue)').toBeGreaterThan(200);
  }, 300_000);

  for (const tag of ELEMENTS) {
    it(`AC6 <${tag}> is drawn as listed or named in an issue`, () => {
      expect(account(cleanRun())[tag], `<${tag}>`).toEqual([]);
    }, 300_000);
  }

  it('AC6 a planted importer that skips <clipPath> without an issue fails, naming clipPath', () => {
    const r = run(PLANTED);
    expect(r.report['ok'], `the planted importer (planted: "${PLANTED}") imports and draws the SVG: ${JSON.stringify(r.report).slice(0, 2000)}`).toBe(true);
    expect(issuesNaming(r.checked, 'clipPath').map((i) => JSON.stringify(i)), 'the planted importer raises no issue naming clipPath').toEqual([]);
    const accounted = account(r);
    expect(accounted.clipPath.length, 'the planted importer that skips <clipPath> fails criterion 6').toBeGreaterThan(0);
    for (const sentence of accounted.clipPath) expect(sentence, 'the failure names the element').toContain('clipPath');
    for (const tag of ELEMENTS.filter((t) => t !== 'clipPath')) expect(accounted[tag], `the planted importer still accounts for <${tag}>, as the clean import does`).toEqual([]);
  }, 300_000);
});

// ---------------------------------------------------------------------------------------------------
// The rounded rect (fixtures/elements/rounded.svg): <rect id="r4" x="20" y="12" width="40" height="24" rx="4"/>,
// ry unset so it resolves to rx; its 80 × 48 viewBox drawn at scale 1 onto [16, 16, 80, 48] of a 112 × 80 board.

describe('#398 AC6 a rect with rx 4 imports with rounded corners within 0.01 u', () => {
  const BOX: [number, number, number, number] = [36, 28, 40, 24];
  const R = 4;
  const TOL = 0.01;
  const roundedDoc = (): VectorDoc => vectorDoc(dir, readFileSync(join(FIXTURES, 'elements', 'rounded.svg')), { id: 'v398-rounded', title: 'Rounded rect', alt: 'a rect with rx 4', docSize: [112, 80], pos: [16, 16], size: [80, 48] });

  it('AC6 the part r4\'s outline is the rect [36, 28, 40, 24] u with corners of radius 4, within 0.01 u, and draws so', () => {
    const v = roundedDoc();
    const parts = geometryParts(v, 'art');
    const part = parts.find((p) => p.id === 'r4');
    expect(part, `geometry answers the part r4 (parts: ${JSON.stringify(parts.map((p) => p.id))})`).toBeDefined();
    expect(part!.box.length, 'the part\'s box is [x, y, w, h]').toBe(4);
    part!.box.forEach((b, i) => expect(Math.abs(b - BOX[i]!), `the part's box[${i}] is ${BOX[i]} u within ${TOL} (got ${JSON.stringify(part!.box)})`).toBeLessThanOrEqual(TOL));
    expect(part!.subpaths.length, 'the part has an outline').toBeGreaterThan(0);
    const points = part!.subpaths.flatMap((sp) => sample(sp));
    const off = points.map((p) => ({ p, d: Math.abs(roundedRectDistance(p, BOX, R)) })).sort((a, b) => b.d - a.d)[0]!;
    expect(off.d, `every point of the outline lies on the rect with corner radius 4 within ${TOL} u; the farthest, (${off.p[0].toFixed(3)}, ${off.p[1].toFixed(3)}), is ${off.d.toFixed(4)} u off`).toBeLessThanOrEqual(TOL);
    // And the outline goes all the way round: every point of the rounded boundary lies within 0.01 u of it.
    const segments = part!.subpaths.flatMap((sp) => { const s = sample(sp); return s.slice(1).map((q, i) => [s[i]!, q] as const); });
    const toSegment = (p: [number, number], [a, b]: readonly [[number, number], [number, number]]): number => {
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
    };
    const missed = roundedRectBoundary(BOX, R).map((p) => ({ p, d: Math.min(...segments.map((s) => toSegment(p, s))) })).sort((a, b) => b.d - a.d)[0]!;
    expect(missed.d, `the outline passes within ${TOL} u of every point of the rounded boundary; (${missed.p[0].toFixed(3)}, ${missed.p[1].toFixed(3)}) is ${missed.d.toFixed(4)} u away`).toBeLessThanOrEqual(TOL);

    // Drawn: each corner pixel lies wholly outside the corner's arc (its nearest point is √18 ≈ 4.24 u from the
    // arc's centre), so it shows the ground; a sharp corner fills it. The middle shows the rect's color.
    const { image } = drawn(dir, v, 'the rounded rect');
    for (const [x, y] of [[36, 28], [75, 28], [36, 51], [75, 51]] as const) {
      expect(pixel(image, x, y), `the corner pixel (${x}, ${y}) lies outside the rounded corner, so it shows the ground`).toSatisfy((c: Rgb) => codeDistance(c, GROUND) <= CODES);
    }
    expect(pixel(image, 56, 40), 'the rect\'s middle shows its fill').toSatisfy((c: Rgb) => codeDistance(c, hex('#1e7b34')) <= CODES);
  }, 300_000);
});

// ---------------------------------------------------------------------------------------------------
// The upstream pairs: each SVG imported as it is, its viewBox 200 × 200 drawn onto [0, 0, 300, 300] of a 300 × 300
// board, the scale resvg drew its PNG at; every color mapped to a role of the same sRGB value over a white ground.

const PAIRS: Record<string, { tag: Tag | 'rect'; names: string[] }> = {
  'masking/clipPath': { tag: 'clipPath', names: ['simple-case', 'clip-rule=evenodd', 'clipPathUnits=objectBoundingBox', 'transform-on-clipPath', 'with-use-child', 'nested-clip-path'] },
  'masking/mask': { tag: 'mask', names: ['maskContentUnits=objectBoundingBox', 'on-group-with-transform', 'half-width-region-with-rotation', 'mask-on-self', 'on-a-small-object', 'with-clip-path'] },
  'paint-servers/pattern': { tag: 'pattern', names: ['simple-case', 'patternUnits=objectBoundingBox', 'with-patternTransform', 'with-viewBox', 'with-x-and-y', 'patternContentUnits=objectBoundingBox'] },
  'painting/marker': { tag: 'marker', names: ['marker-on-line', 'only-marker-end', 'orient=30', 'marker-on-polyline', 'default-clip', 'with-markerUnits=userSpaceOnUse'] },
  'structure/style': { tag: 'style', names: ['class-selector', 'iD-selector', 'type-selector', 'attribute-selector', 'style-inside-CDATA', 'resolve-order'] },
  'shapes/rect': { tag: 'rect', names: ['simple-case', 'rounded-rect', 'rx-attribute-resolving', 'rx-attribute-clamping', 'rx-and-ry-attributes-clamping-order'] },
};

/**
 * Redraft 2 (REDRAFT-AC6.md): four pattern pairs whose resvg PNG snaps tile edges that fall on half pixels at 300 × 300
 * are judged against the pinned headless Chrome's render of the same SVG instead (Chrome for Testing 156.0.8078.4,
 * made by chrome-reference.mjs, checked in under fixtures/chrome/), each PNG pinned by its sha256.
 */
const CHROME_REFERENCES: Record<string, string> = {
  'paint-servers/pattern/with-x-and-y': '8611e4742c2c35f2c1d64f23d8939e75cbf39bf65843ab1a38694ac1b8befed4',
  'paint-servers/pattern/patternUnits=objectBoundingBox': '7d4ad317d49a29966f41e69799d947b33178b23679b9b13452ffd50d827dc8e6',
  'paint-servers/pattern/patternContentUnits=objectBoundingBox': 'f72952fb5a1e57855424680fd5372a75d43874e1f42f0f8214a2806b99b778ff',
  'paint-servers/pattern/with-viewBox': '967242db11283df50cb8f23b7e86993a0861180e5684a380f9264564bd53aef4',
};

describe('#398 AC6 resvg 77b12f4951\'s pairs run on our code: each drawn to its PNG through the perceptual oracle, or its element named in an issue', () => {
  for (const [folder, { tag, names }] of Object.entries(PAIRS)) {
    for (const name of names) {
      it(`AC6 resvg ${folder}/${name}`, () => {
        const svg = readFileSync(join(FIXTURES, 'resvg', folder, `${name}.svg`));
        const pinned = CHROME_REFERENCES[`${folder}/${name}`];
        const by = pinned ? 'the pinned Chrome\'s PNG' : 'resvg\'s PNG';
        const bytes = readFileSync(join(FIXTURES, pinned ? 'chrome' : 'resvg', folder, `${name}.png`));
        if (pinned) expect(sha256(bytes), `${by} for ${folder}/${name} is the one chrome-reference.mjs made`).toBe(pinned);
        const reference = decodePng(bytes);
        expect([reference.width, reference.height], `${by} draws the 200-unit viewBox at 300 × 300`).toEqual([300, 300]);
        const v = vectorDoc(dir, svg, { id: 'v398-resvg', title: name, alt: `resvg ${folder}/${name}`, docSize: [300, 300], pos: [0, 0], size: [300, 300] });
        // The elements outside the list this SVG holds; a rect is on the list and must draw.
        const text = svg.toString('utf8');
        const outside = ELEMENTS.filter((t) => new RegExp(`<${t}[\\s>]`).test(text));
        if (tag !== 'rect') expect(outside, `the SVG holds <${tag}>`).toContain(tag);
        const checked = check(v);
        const named = tag === 'rect' ? [] : outside.filter((t) => issuesNaming(checked, t).length > 0);
        if (named.length > 0) return; // returned as an issue naming the element: accounted for, never drawn silently
        const { report, image } = raster(dir, v);
        expect(report['ok'], `${folder}/${name} draws through our import, or an issue names ${tag === 'rect' ? 'what stops it' : outside.map((t) => `<${t}>`).join(' or ')}: raster answered ${JSON.stringify(report).slice(0, 1500)}; check answered ${JSON.stringify(checked.raw).slice(0, 1500)}`).toBe(true);
        const verdict = perceptual(reference, image!, `${folder}/${name}`);
        expect(verdict.problems, `${folder}/${name} against ${by} through the perceptual oracle (${JSON.stringify(verdict.numbers)})`).toEqual([]);
        // The comparison's planted-mismatch twins: the oracle rejects the reference with its subject erased or moved.
        for (const twin of plantedMismatches(reference)) {
          expect(perceptual(reference, twin.image, twin.name).problems.length, `the oracle rejects ${folder}/${name}'s reference with ${twin.name}`).toBeGreaterThan(0);
        }
      }, 300_000);
    }
  }
});
