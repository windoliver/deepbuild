// #1399.cfce1159: "A planted kind with a field that never reaches a shader fails `field.effect`, naming the field"
//
// The kind kit runs at the pack check (`install_pack`, #202). The planted kind is acme/shelf@1.0.1's shelf.bookcase@1,
// whose recipe declares one more input, `gloss` (a number 0 to 1, default 0.5), that no step of the recipe reads: an
// item may set it and it validates, but it never reaches what the frame draws. One test:
//   - the control, acme/shelf@1.0.0, the same kind without `gloss` (width, levels and dividers each change what it
//     draws), installs;
//   - the planted acme/shelf@1.0.1 is refused at its kit, with an error (not `unknown_field`) that names the kit's
//     part `field.effect` and the field `gloss`, each as data (a value of the issue, outside its prose).
// At the base the kit has no `field.effect` part, so acme/shelf@1.0.1 installs.

import { describe, expect, it } from 'vitest';

import { installed, installPack, kitPartErrors, names, packAt, runShow, show, sub, useBinary, useTemp, writeShelf } from './helpers.ts';

const AC = '#1399.cfce1159';
const bin = useBinary('deep-show');
const temp = useTemp();

describe(`${AC} in a kind's kit, each field changed from its default must change the evaluated frame`, () => {
  it(`${AC} a planted kind with a field that never reaches a shader fails field.effect, naming the field`, () => {
    const clean = writeShelf(temp(), '1.0.0');
    const planted = writeShelf(temp(), '1.0.1', {
      extraInputs: { gloss: { type: 'number', default: 0.5, min: 0, max: 1, about: 'a surface gloss, which no step of the recipe reads' } },
    });
    const [a, b] = runShow(bin(), { evidence: sub(temp(), 'evidence'), calls: [installPack(clean), installPack(planted)] });

    const control = installed(a!, clean);
    expect(control.outcome, `the control ${packAt(clean)}, whose every field changes what it draws, installs: ${show(control.raw, 3000)}`).toBe('installed');

    const r = installed(b!, planted);
    expect(r.outcome, `${packAt(planted)}, whose field gloss no step reads, is refused at its kind kit: ${show(r.raw, 3000)}`).toBe('refused');
    const failing = kitPartErrors(r, 'field.effect');
    expect(failing.length, `the refusal has an error naming the kit's part field.effect: ${show(r.issues, 3000)}`).toBeGreaterThan(0);
    expect(failing.some((i) => names(i, 'gloss')), `an error of field.effect names the field gloss: ${show(failing, 3000)}`).toBe(true);
  });
});
