// AC4: every bundled font's licence allows embedding, recorded beside it. AC8: every shipped look defines the
// `math` role with a bundled math face whose licence allows embedding, recorded beside it.
//
// The bundled fonts are the files in crates/deep-text/fonts (the only fonts the canvas's text uses). `deep-text
// fonts` lists every bundled face with its licence (an SPDX ID) and the licence file beside it. Each is held
// to: a licence that allows embedding (README: Licences), its text in a file in the same folder as the face,
// and the face's own OS/2 embedding bits (fsType) not restricted and not bitmap-only, for every face of a
// collection. Each shipped look's `fonts` entries name bundled faces, `embed: true`, with the face's licence;
// its `math` role names a font whose file is a bundled face carrying an OpenType MATH table (a math face, as
// New Computer Modern Math is). At the base `fonts` lists one regular face per role with no licence, and no
// look has a math role.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRST_LOOKS, FONT_DIR, REPO, bundledFaces, embeddable, faceCount, fontFileOf, fsType, hasTable, isFontFile, licenceProblems, obj, readFace,
  sfnt, shippedIds, shippedLook, str, useBinaries, type Face,
} from './helpers.ts';

useBinaries('deep-text', 'deep-canvas-render');

const onDisk = (): string[] => readdirSync(join(REPO, FONT_DIR)).filter(isFontFile).map((f) => `${FONT_DIR}/${f}`).sort();

/** Every face of a font file whose own embedding bits forbid embedding it as outlines. */
function unembeddableFaces(rel: string): string[] {
  const bytes = readFileSync(join(REPO, rel));
  const out: string[] = [];
  for (let i = 0; i < faceCount(bytes); i++) {
    const type = fsType(sfnt(bytes, i));
    if (!embeddable(type)) out.push(`${rel} face ${i}: OS/2 fsType ${type === null ? 'missing' : `0x${type.toString(16).padStart(4, '0')}`}`);
  }
  return out;
}

/** A shipped look's problems with its fonts: each a bundled face, embeddable, with that face's licence. */
function lookFontProblems(id: string, faces: Face[]): string[] {
  const look = shippedLook(id);
  const fonts = obj(look.def['fonts'], `${id}: fonts`);
  const out: string[] = [];
  for (const [name, v] of Object.entries(fonts)) {
    const entry = obj(v, `${id}: fonts.${name}`);
    const file = str(entry['file'], `${id}: fonts.${name}.file`);
    const face = faces.find((f) => f.file.split('/').at(-1) === file);
    if (!face) { out.push(`${id}: fonts.${name} names ${file}, not a bundled face`); continue; }
    if (entry['embed'] !== true) out.push(`${id}: fonts.${name} isn't embed: true`);
    if (entry['license'] !== face.license) out.push(`${id}: fonts.${name} records licence ${String(entry['license'])}, the face's is ${face.license}`);
  }
  return out;
}

describe('#417 AC4 every bundled font\'s licence allows embedding, recorded beside it', () => {
  it('AC4 deep-text fonts lists every font file bundled, each with a licence that allows embedding and that licence\'s text beside it', () => {
    const faces = bundledFaces();
    expect(faces.map((f) => f.file).sort(), `deep-text fonts lists exactly the font files in ${FONT_DIR}`).toEqual(onDisk());
    expect(faces.flatMap(licenceProblems)).toEqual([]);
  });

  it('AC4 every bundled font file\'s own embedding bits allow embedding, in every face of a collection', () => {
    expect(onDisk().length, 'fonts are bundled').toBeGreaterThan(0);
    expect(onDisk().flatMap(unembeddableFaces)).toEqual([]);
  });

  it('AC4 every font a shipped look names is a bundled face, embed: true, carrying that face\'s licence', () => {
    const faces = bundledFaces();
    const ids = shippedIds();
    for (const id of FIRST_LOOKS) expect(ids).toContain(id);
    expect(ids.flatMap((id) => lookFontProblems(id, faces))).toEqual([]);
  });

  it('AC4 the licence oracle refuses what it should: a restricted or bitmap-only fsType, a GPL or unknown licence, a licence file that isn\'t beside the face or isn\'t that licence', () => {
    expect([0x0000, 0x0004, 0x0008].map(embeddable), 'installable, preview & print and editable embedding allow it').toEqual([true, true, true]);
    expect([0x0002, 0x0200, 0x0208, null].map(embeddable), 'restricted, bitmap-only or no OS/2 table do not').toEqual([false, false, false, false]);
    const inter = { file: `${FONT_DIR}/Inter-Regular.ttf`, family: 'Inter', license: 'OFL-1.1', licenseFile: `${FONT_DIR}/LICENSE-Inter.txt` };
    expect(licenceProblems(inter), 'Inter under its own OFL text passes').toEqual([]);
    expect(licenceProblems({ ...inter, license: 'GPL-3.0-only' }).length, 'a GPL licence fails').toBeGreaterThan(0);
    expect(licenceProblems({ ...inter, license: 'LicenseRef-proprietary' }).length, 'an unknown licence fails').toBeGreaterThan(0);
    expect(licenceProblems({ ...inter, license: 'Apache-2.0' }).length, 'a licence file that isn\'t that licence fails').toBeGreaterThan(0);
    expect(licenceProblems({ ...inter, licenseFile: 'LICENSE' }).length, 'a licence file elsewhere fails').toBeGreaterThan(0);
  });
});

describe('#417 AC8 every shipped look defines the math role with a bundled math face whose licence allows embedding, recorded beside it', () => {
  it('AC8 each shipped look\'s math role names an embeddable bundled face that carries a MATH table, its licence recorded beside it and in the look', () => {
    const faces = bundledFaces();
    for (const id of shippedIds()) {
      const look = shippedLook(id);
      for (const theme of ['light', 'dark'] as const) {
        expect(look.fontRoles[theme]['math'], `${id} ${theme}: the math role names one of the look's fonts`).toBeDefined();
        const { name, file, entry } = fontFileOf(look, 'math', theme);
        const face = faces.find((f) => f.file.split('/').at(-1) === file);
        expect(face, `${id}: fonts.${name} (${file}) is a bundled face`).toBeDefined();
        expect(hasTable(readFace(face!.file), 'MATH'), `${id}: ${file} is a math face (it carries an OpenType MATH table)`).toBe(true);
        expect(unembeddableFaces(face!.file), `${id}: ${file}'s embedding bits allow embedding`).toEqual([]);
        expect(licenceProblems(face!), `${id}: ${file}'s licence allows embedding and sits beside it`).toEqual([]);
        expect(entry['embed'], `${id}: fonts.${name} is embed: true`).toBe(true);
        expect(entry['license'], `${id}: fonts.${name} records the face's licence`).toBe(face!.license);
      }
    }
  });

  it('AC8 the math-face oracle tells a text face from a math face: Inter carries no MATH table', () => {
    expect(hasTable(readFace(`${FONT_DIR}/Inter-Regular.ttf`), 'MATH'), 'Inter is not a math face').toBe(false);
    expect(hasTable(readFace(`${FONT_DIR}/Inter-Regular.ttf`), 'cmap'), 'the reader finds Inter\'s tables').toBe(true);
  });
});
