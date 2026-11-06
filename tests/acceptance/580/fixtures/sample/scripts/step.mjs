// One line in <obs>/steps.jsonl for each start step that really ran: what the tests read beside the run's record.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function logged(step) {
  const { dir, name } = JSON.parse(readFileSync('obs.json', 'utf8'));
  appendFileSync(join(dir, 'steps.jsonl'), `${JSON.stringify({ step, name, cwd: process.cwd(), database: process.env.DATABASE_URL ?? null, at: Date.now() })}\n`);
}
if (process.argv[2]) logged(process.argv[2]);
