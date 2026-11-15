import { expect, it } from 'vitest';
import { neverEnds } from '../src/waits.js';

it('treats tail flags as following only for Heroku and requires an explicit Vitest watch', () => {
  for (const command of ['heroku logs -t', 'heroku logs --tail', 'npx vitest --watch']) expect.soft(neverEnds(command), command).toBe(true);
  for (const command of ['docker logs -t app', 'journalctl -t app', 'npx vitest example.test.ts', 'echo "ready; tail -f app.log"']) expect.soft(neverEnds(command), command).toBe(false);
});
