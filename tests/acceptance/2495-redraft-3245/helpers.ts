// #2495's helpers, reused as they are, with the judge #3245 needs (REDRAFT.md): the fake `codex` answers the eval's
// first request, the control, and scores every other as #2495's does.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openWorld as original, type World } from '../2495/helpers.ts';

export * from '../2495/helpers.ts';
/**
 * The judge: scores each unlabeled output by the quality in it. A request that holds no task's words is the control, the
 * package's own: of its two outputs the change is the one a git diff shows.
 */
const FAKE_CODEX = `#!${process.execPath}
let s = '';
process.stdin.on('data', (d) => { s += d; }).on('end', () => {
  const parts = s.split(/=== Output (.+?) ===\\n/);
  const control = !s.includes('Fix the cart total in case');
  const grades = [];
  for (let i = 1; i < parts.length; i += 2) {
    const text = parts[i + 1] ?? '';
    const m = /quality=([0-9.]+)/.exec(text);
    grades.push({ label: parts[i], score: control ? (/^(?:diff --git |@@ |\\+)/m.test(text) ? 0.9 : 0.1) : m ? Number(m[1]) : 0 });
  }
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ grades }) } }));
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 5 } }));
});
`;
/** #2495's world, its fake `codex` written over with this judge. */
export async function openWorld(): Promise<World> {
  const w = await original();
  writeFileSync(join(w.bin, 'codex'), FAKE_CODEX);
  return w;
}
