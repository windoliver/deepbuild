// What #3562's fourth criterion reads from an output of docs/spikes/3539/reply-hold.mjs, as a function of the output
// alone (README, AC4). The fields are the script's own, as it writes them at the base: `runs`; for each stop, the
// count of runs in which its `turnEnded` had returned while its checks waited; `started_as_asked`, the count of runs
// in which the four runs started in the order they asked; and `taken`, each run with its own `readings`. Each count is
// checked against the runs it counts, so a summary that says more than its runs do is named.

/** How many runs the criterion asks for. */
export const RUNS = 20;
/** The order the four runs ask for a slot in, as the issue's table gives it. */
export const ASKED = ['other:first', 'other:second', 'person:first', 'person:second'];
/** The two stops, each with the field that reads whether its `turnEnded` had returned while its checks waited. */
export const STOPS = [
  { stop: "other's stop", field: 'other_turn_end_returned_while_its_second_check_waited', waits: 'its second check waited' },
  { stop: "the person's stop", field: 'person_turn_end_returned_while_its_checks_waited', waits: 'its checks waited' },
];

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const inOrder = (run) => Array.isArray(run?.readings?.started_in_order) && run.readings.started_in_order.join() === ASKED.join();

/**
 * What is wrong with an output, each line naming the stop or the order it is about; none when it reads as the
 * criterion says. `want` is `RUNS` for the change (20 of 20 for each stop, and the four runs in the order they asked
 * in 20 of 20) and 0 for the merge base (0 of 20, and 0 of 20). An output with fewer runs than 20 reads nothing.
 */
export function problems(output, want) {
  if (!isObject(output)) return ['the output is no JSON object'];
  const taken = Array.isArray(output.taken) ? output.taken : [];
  const found = [];
  if (output.runs !== RUNS || taken.length !== RUNS) found.push(`the output holds ${taken.length} runs and says runs: ${JSON.stringify(output.runs)}; the criterion asks for ${RUNS}`);
  for (const { stop, field, waits } of STOPS) {
    const counted = taken.filter((run) => run?.readings?.[field] === true).length;
    if (output[field] !== want) found.push(`${stop}: its turnEnded had returned while ${waits} in ${JSON.stringify(output[field])} of ${RUNS} runs (${field}); the criterion asks for ${want} of ${RUNS}`);
    if (counted !== output[field]) found.push(`${stop}: ${field} says ${JSON.stringify(output[field])}, but ${counted} of the ${taken.length} runs in taken read it true`);
  }
  const ordered = taken.filter(inOrder).length;
  if (output.started_as_asked !== want) found.push(`the order: the four runs started in the order they asked (${ASKED.join(', ')}) in ${JSON.stringify(output.started_as_asked)} of ${RUNS} runs (started_as_asked); the criterion asks for ${want} of ${RUNS}`);
  if (ordered !== output.started_as_asked) {
    const other = taken.find((run) => !inOrder(run));
    found.push(`the order: started_as_asked says ${JSON.stringify(output.started_as_asked)}, but ${ordered} of the ${taken.length} runs in taken started ${ASKED.join(', ')}${other ? `; one started ${JSON.stringify(other?.readings?.started_in_order)}` : ''}`);
  }
  return found;
}
