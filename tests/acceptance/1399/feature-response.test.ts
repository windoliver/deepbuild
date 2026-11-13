// #1399.6334af37: "Removing a fixture feature that moves too little fails `feature.response`, naming the band"
//
// A kind declares `"feature.response": {ablate, measure, band}` (README: The surface under test): the kit removes the
// recipe step `ablate` from the kind's example and requires the change in `measure`, the count of items the instance
// expands into, to lie within `band` [min, max], inclusive. The bookcase's example is the kind at its defaults: 2 sides,
// 4 boards and 1 divider, 7 items. One test:
//   - the planted acme/shelf@1.0.2 declares {ablate: "dividers", measure: "items", band: [2, 4]}: removing the dividers
//     moves the count by 1, too little, so it is refused at its kit with an error (not `unknown_field`) naming the kit's
//     part `feature.response` and the band [2, 4], each as data;
//   - the control acme/shelf@1.0.3 declares {ablate: "boards", measure: "items", band: [1, 8]}: removing the boards
//     moves the count by 4, inside its band (and by levels, 1 to 8, at any level), so it installs.
// At the base a kind's `feature.response` is an unknown field: both versions are refused with `unknown_field`.

import { describe, expect, it } from 'vitest';

import { installed, installPack, kitPartErrors, names, packAt, runShow, show, sub, useBinary, useTemp, writeShelf } from './helpers.ts';

const AC = '#1399.6334af37';
const bin = useBinary('deep-show');
const temp = useTemp();

const BAND = [2, 4];

describe(`${AC} a kind may declare an ablation with a band, so removing the feature must change the measure by that much`, () => {
  it(`${AC} removing a fixture feature that moves too little fails feature.response, naming the band`, () => {
    const planted = writeShelf(temp(), '1.0.2', { extraFields: { 'feature.response': { ablate: 'dividers', measure: 'items', band: BAND } } });
    const control = writeShelf(temp(), '1.0.3', { extraFields: { 'feature.response': { ablate: 'boards', measure: 'items', band: [1, 8] } } });
    const [a, b] = runShow(bin(), { evidence: sub(temp(), 'evidence'), calls: [installPack(planted), installPack(control)] });

    const r = installed(a!, planted);
    expect(r.outcome, `${packAt(planted)}, whose dividers move its items by 1 against the band [2, 4], is refused at its kind kit: ${show(r.raw, 3000)}`).toBe('refused');
    const failing = kitPartErrors(r, 'feature.response');
    expect(failing.length, `the refusal has an error naming the kit's part feature.response (not unknown_field): ${show(r.issues, 3000)}`).toBeGreaterThan(0);
    expect(failing.some((i) => names(i, BAND)), `an error of feature.response names the band [2, 4]: ${show(failing, 3000)}`).toBe(true);

    const c = installed(b!, control);
    expect(c.outcome, `the control ${packAt(control)}, whose boards move its items by 4 inside the band [1, 8], installs: ${show(c.raw, 3000)}`).toBe('installed');
  });
});
