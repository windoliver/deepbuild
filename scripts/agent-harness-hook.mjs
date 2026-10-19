// The hooks agent-harness.mjs installs through a session's --settings: `event` records each payload,
// `hold` answers the first Stop with decision: block, and `wake` is the asyncRewake waiter that exits 2
// a few seconds after the first Stop, so the idle session wakes. The answer stays in a file, never on
// a command line the transcript could show before it is delivered.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, dir] = process.argv.slice(2);
const input = JSON.parse(readFileSync(0, 'utf8'));
const events = join(dir, 'events.jsonl');
const stops = () => readFileSync(events, 'utf8').split('\n').filter((line) => line.includes('"hook_event_name":"Stop"')).length;
appendFileSync(events, `${JSON.stringify({ mode, at: Date.now(), ...input })}\n`);
const answer = () => readFileSync(join(dir, 'answer.txt'), 'utf8');

if (mode === 'hold' && input.hook_event_name === 'Stop' && !input.stop_hook_active && stops() === 1)
  process.stdout.write(JSON.stringify({ decision: 'block', reason: answer() }));
if (mode === 'wake' && input.hook_event_name === 'Stop' && stops() === 1) {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  process.stderr.write(answer());
  process.exit(2);
}
