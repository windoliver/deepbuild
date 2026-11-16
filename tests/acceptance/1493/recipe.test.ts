// AC6 (README: recipe.test.ts): "mapped" can't mean "parses". When a familiar-names pack is admitted, each recipe an
// alias targets runs #1399's `field.effect`. The control, acme/names@1.0.0, maps Shelf onto names.shelf@1, whose every
// input changes what it draws; the planted acme/names@1.0.1 adds the input gloss, mapped in its census from the
// reference's constructor parameter, that no step reads. Both go through `install_pack` in one `deep-show run`.

import { describe, expect, it } from 'vitest';

import { installed, installPack, kitPartErrors, names, namesCensus, packAt, runShow, show, sub, useShow, useTemp, writeNames, type JsonObject } from './helpers.ts';

const AC6 = '#1493.d175c804';
const bin = useShow();
const temp = useTemp();

describe(`${AC6} a mapped word's recipe must use every parameter it accepts`, () => {
  it(`${AC6} a planted recipe that accepts a parameter and ignores it fails through field.effect, naming the parameter`, () => {
    const clean = writeNames(temp(), '1.0.0');
    const c = namesCensus();
    (c['params'] as JsonObject[]).push({ name: 'Shelf', param: 'gloss', state: 'mapped', target: 'gloss' });
    ((c['totals'] as JsonObject)['params'] as JsonObject)['mapped'] = 4;
    const planted = writeNames(temp(), '1.0.1', {
      census: c,
      extraInputs: { gloss: { type: 'number', default: 0.5, min: 0, max: 1, about: 'a surface gloss, which no step of the recipe reads' } },
    });
    const [a, b] = runShow(bin(), { evidence: sub(temp(), 'evidence'), calls: [installPack(clean), installPack(planted)] });

    const control = installed(a!, clean);
    expect(control.outcome, `the control ${packAt(clean)}, whose every input changes what it draws, installs: ${show(control.raw, 3000)}`).toBe('installed');

    const r = installed(b!, planted);
    expect(r.outcome, `${packAt(planted)}, whose mapped input gloss no step reads, is refused: ${show(r.raw, 3000)}`).toBe('refused');
    const failing = kitPartErrors(r, 'field.effect');
    expect(failing.length, `the refusal has an error naming the kit's part field.effect: ${show(r.issues, 3000)}`).toBeGreaterThan(0);
    expect(failing.some((i) => names(i, 'gloss')), `an error of field.effect names the input gloss: ${show(failing, 3000)}`).toBe(true);
  }, 3_600_000);
});
