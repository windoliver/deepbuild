// Criterion 5 (no upstream test): "In the shot lab, a Spawn expression that reads `powr` on a `shot` occurrence whose
// only field is `power` is refused at check, naming the Spawn, `powr` and `power`. A planted reader that reads an
// undeclared field as 0 passes the check and fails, naming the Spawn"
//
// Through `deep-show run`'s `deep show` (the document check): the shot lab (fixtures.ts) whose spawn `shots` has the
// gain expression `powr - 1` (doc a), and the same spelled `power - 1` (doc b), which must check, so the refusal is of
// the misspelling and not of every expression. The refusal is the issue `occurrence.undeclared`, read as criterion 4
// reads it (helpers.ts `undeclaredFailures`).
import { describe, it } from 'vitest';
import { AC, DOC, TIMEOUT, asset, failsNaming, none, notPresented, prebuild, present, putEvidence, runShow, scenario, tone, undeclaredFailures, useTemp, type JsonObject, type ShowPlanted } from './helpers.ts';
import { shot } from './programs.ts';
import { SPAWN, VOICE_FRAMES, labDoc } from './fixtures.ts';

prebuild(['deep-show']);
const temp = useTemp();

/** The check of the lab whose spawn reads `powr`, and of the lab spelled right; each failure names the spawn. */
function checkFailures(planted?: ShowPlanted): string[] {
  const ev = temp();
  const program = putEvidence(ev, shot().bytes);
  const t = asset(ev, tone(1000, VOICE_FRAMES, 0.5)).sha;
  const [typo, right] = runShow(scenario(ev, [present(DOC.a, labDoc(program, t, 'powr - 1')), present(DOC.b, labDoc(program, t, 'power - 1'))], planted), 'the shot lab checked, misspelled and spelled right') as [JsonObject, JsonObject];
  const failures = undeclaredFailures(typo, { reader: SPAWN, wrong: 'powr', declared: 'power' }, `the lab whose spawn ${SPAWN} has the gain powr - 1`);
  const checks = notPresented(right, `the lab whose spawn ${SPAWN} has the gain power - 1`);
  if (checks) failures.push(`${SPAWN}: spelled right, ${checks}`);
  return failures;
}

describe(`${AC[5]} a Spawn expression that reads a field its occurrence kind doesn't declare is refused at check, with the close names`, () => {
  it(`${AC[5]} the spawn ${SPAWN} reading powr on shot {power: f64} is refused with occurrence.undeclared, naming ${SPAWN}, powr and power; spelled right it checks`, () => {
    none(checkFailures(), `the check of ${SPAWN}'s gain`);
  }, TIMEOUT);

  it(`${AC[5]} a planted reader that reads an undeclared field as 0 (undeclared_field_reads_zero) passes the check, and the test fails, naming ${SPAWN}`, () => {
    none(checkFailures(), `the check of ${SPAWN}'s gain`);
    failsNaming(checkFailures('undeclared_field_reads_zero'), new RegExp(`\\b${SPAWN}\\b`), 'undeclared_field_reads_zero');
  }, TIMEOUT);
});
