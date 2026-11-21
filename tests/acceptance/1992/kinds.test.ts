// The scope line "deep_kinds lists the new fields", held for the field each of AC1, AC3 and AC4 reads (README:
// Criteria to tests). `deep_kinds {op: "field", path: "<kind>@<major>"}` on the full build's `deep-show run` (#412's
// tool, #1973's line shape: a line per field with its `name`, `default` and the `forms` it's written in) answers:
//   - AC1 #1992.cf298652: `sky@1` lists `fog_curve` with forms that name `exp`, `exp2` and `linear` with its `near`
//     and `far`, and its default is still `exp2`;
//   - AC3 #1992.5703f3eb: `mark.line@1`, `mark.point@1` and `mark.image@1` each list `fog` with the default true, and
//     `mark.text@1` lists it with the default false;
//   - AC4 #1992.6b71e62f: `sky@1` lists `background_intensity` with the default 1.
// Wrong programs: the base (no linear form, no `background_intensity`, no image mark, `fog` on a line alone and with
// no default); a field the renderer reads and the listing leaves out; a default the listing states the other way.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC, kindFields, none, shown, useBin, type JsonObject, type JsonValue } from './helpers.ts';

const bin = useBin('deep-show');
const KINDS = ['sky@1', 'mark.line@1', 'mark.point@1', 'mark.image@1', 'mark.text@1'];
let evidence = '';
afterAll(() => { if (evidence) rmSync(evidence, { recursive: true, force: true }); });
/** Every listed kind's field lines, asked once for the file. */
let asked: Map<string, JsonObject[] | string> | undefined;
function fields(): Map<string, JsonObject[] | string> {
  if (asked) return asked;
  evidence = mkdtempSync(join(tmpdir(), 'deep-1992-kinds-'));
  const replies = kindFields(bin(), evidence, KINDS);
  return (asked = new Map(KINDS.map((k, i) => [k, replies[i]!])));
}
/** Why `kind` doesn't list `field` as `check` wants it, or nothing. */
function listed(kind: string, field: string, check: (line: JsonObject) => string): string[] {
  const lines = fields().get(kind)!;
  if (typeof lines === 'string') return [`${kind}.${field}: ${lines}`];
  const line = lines.find((l) => l['name'] === field);
  if (!line) return [`${kind}.${field}: deep_kinds lists no such field; ${kind} lists ${lines.map((l) => String(l['name'])).join(', ')}`];
  const why = check(line);
  return why ? [`${kind}.${field}: ${why}: ${shown(line, 500)}`] : [];
}
const formsText = (line: JsonObject): string => JSON.stringify(line['forms'] ?? line['form'] ?? '');
const defaults = (want: JsonValue) => (line: JsonObject): string => (line['default'] === want ? '' : `its default is ${shown(line['default'])}, not ${shown(want)}`);

describe('deep_kinds lists the new fields', () => {
  it(`${AC[1]} deep_kinds lists sky@1.fog_curve with the forms exp, exp2 and linear {near, far}, its default exp2`, () => {
    none(listed('sky@1', 'fog_curve', (line) => {
      const forms = formsText(line);
      const missing = ['exp', 'exp2', 'linear', 'near', 'far'].filter((w) => !new RegExp(`(^|[^A-Za-z0-9_])${w}([^A-Za-z0-9_]|$)`).test(forms));
      return missing.length ? `its forms don't name ${missing.join(', ')}` : defaults('exp2')(line);
    }), 'deep_kinds lists the linear curve');
  }, 3_600_000);

  it(`${AC[3]} deep_kinds lists fog on mark.line@1, mark.point@1 and mark.image@1 with the default true, and on mark.text@1 with the default false`, () => {
    none([
      ...['mark.line@1', 'mark.point@1', 'mark.image@1'].flatMap((kind) => listed(kind, 'fog', defaults(true))),
      ...listed('mark.text@1', 'fog', defaults(false)),
    ], 'deep_kinds lists fog on the four marks with their defaults');
    expect(typeof fields().get('mark.image@1'), 'deep_kinds lists the kind mark.image@1').not.toBe('string');
  }, 3_600_000);

  it(`${AC[4]} deep_kinds lists sky@1.background_intensity with the default 1`, () => {
    none(listed('sky@1', 'background_intensity', defaults(1)), 'deep_kinds lists the background\'s own intensity');
  }, 3_600_000);
});
