// #2064 review regressions: grouping and literal shell wrappers are still PR calls, never an excuse not to gate.
import { expect, it } from 'vitest';
import { prBody, prCommands } from '../src/pr-commands.js';

const body = 'Closes #7';
const pr = `gh pr create --title t --body '${body}'`;
const bodies = (command: string) => Promise.all(prCommands(command).map((p) => prBody(p, '.')));

it('recognizes a PR in shell groups and conditional/loop bodies', async () => {
  for (const command of [`git push && { ${pr}; }`, `if false; then true; else ${pr}; fi`, `while ${pr}; do break; done`, `(${pr})`, `{ gh pr edit 3 --body '${body}'; }`]) {
    expect(await bodies(command), command).toEqual([body]);
  }
});

it('reads literal wrappers without executing them', async () => {
  for (const command of [`time ${pr}`, `nohup ${pr}`, `env -u GH_DEBUG ${pr}`, `sudo -u builder -- ${pr}`, `bash -c "${pr}"`, `/bin/sh -ec "${pr}"`, `eval "${pr}"`]) {
    expect(await bodies(command), command).toEqual([body]);
  }
  expect(await bodies(`echo "${pr}"`)).toEqual([]);
  await expect(bodies('bash -c \'gh pr create --body "$BODY"\'')).rejects.toThrow(/expansion/);
});
