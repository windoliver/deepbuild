import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, bashCall, buildBase, buildDeepHook, cleanup, decision, failureOf, hook, must, newSession, preToolUse,
  shown, stoppedHome, told, type Ran,
} from '../1503/helpers.ts';
import { stoppedBaseHome } from './base-defaults.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

interface Case { line: string; guards: string[]; spelling: string }
const SETTINGS = ['no-agent-config-write'];
const HOME_WRITE = ['no-deepbuild-home-write'];
const TOKEN = ['no-control-token-read', 'no-deepbuild-home-write'];

const ac1 = (home: string): Case[] => [
  { line: `python3 -c "open('${home}/.claude/settings.json','w').write('{}')"`, guards: SETTINGS, spelling: 'plain path' },
  { line: `python3 -c "import os; open(os.path.expanduser('~/.deepbuild/rules.json'),'w').write('{}')"`, guards: HOME_WRITE, spelling: '~ through expanduser' },
  { line: `python3 -c "print(open('$HOME/.deepbuild/control.token').read())"`, guards: TOKEN, spelling: '$HOME' },
  { line: `node -e "require('fs').writeFileSync(require('os').homedir()+'/.claude/settings.json','{}')"`, guards: SETTINGS, spelling: 'homedir()' },
  { line: `node -e "require('fs').writeFileSync('$HOME/.deepbuild/rules.json','{}')"`, guards: HOME_WRITE, spelling: '$HOME' },
  { line: `node -e "console.log(require('fs').readFileSync('${home}/.deepbuild/control.token','utf8'))"`, guards: TOKEN, spelling: 'plain path' },
];
const AC2_CASES: Case[] = [
  {
    line: "python3 <<'EOF'\nimport os, sqlite3\ndb = sqlite3.connect(os.path.expanduser('~/.deepbuild/ledger.db'))\ndb.execute('DELETE FROM events')\ndb.commit()\nEOF",
    guards: HOME_WRITE,
    spelling: "python3 <<'EOF', ~ through expanduser",
  },
  {
    line: "python3 - <<EOF\nimport sqlite3\nsqlite3.connect('$HOME/.deepbuild/ledger.db').execute('DROP TABLE events')\nEOF",
    guards: HOME_WRITE,
    spelling: 'python3 - <<EOF, $HOME',
  },
];

async function observe(binary: string, cases: (home: string) => Case[], stopped: () => Promise<{ home: string }>): Promise<{ cases: Case[]; runs: Ran[] }> {
  const { home } = await stopped();
  const s = newSession(home);
  const list = cases(home);
  const runs: Ran[] = [];
  for (const c of list) runs.push(await hook(home, preToolUse(s, bashCall(c.line)), binary));
  return { cases: list, runs };
}

function judgeDenied(o: { cases: Case[]; runs: Ran[] }): void {
  o.cases.forEach((c, i) => {
    const got = o.runs[i]!;
    must(decision(got) === 'deny', `\`${c.line}\` (${c.spelling}) must be denied with the hub stopped: ${shown(got)}`);
    must(c.guards.some((g) => told(got).includes(g)), `\`${c.line}\`: the denial must name the guard, ${c.guards.join(' or ')}: ${shown(got)}`);
  });
}

describe(`AC1 ${AC1} python3 -c and node -e writing agent config or rules.json, or reading the control token, are denied with the hub stopped`, () => {
  it('AC1 each of the six python3 -c and node -e calls is denied with the hub stopped, naming the guard', async () => {
    judgeDenied(await observe(BIN, ac1, stoppedHome));
  }, 900_000);

  it('AC1 (wrong program) deep-hook on the merge base allows all of them and fails this test, naming the call (redraft defaults)', async () => {
    const seen = await observe(await buildBase(), ac1, stoppedBaseHome);
    const failure = await failureOf(() => judgeDenied(seen));
    expect(failure, 'deep-hook on the merge base must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the call').toContain(seen.cases[0]!.line);
    seen.cases.forEach((c, i) => {
      expect(decision(seen.runs[i]!), `the merge base allows \`${c.line}\` with the hub stopped: ${shown(seen.runs[i]!)}`).toBe('allow');
    });
  }, 900_000);
});

describe(`AC2 ${AC2} a python heredoc naming ~/.deepbuild/ledger.db is denied the same way`, () => {
  it("AC2 python3 <<'EOF' and python3 - <<EOF naming ~/.deepbuild/ledger.db are each denied with the hub stopped, naming the guard", async () => {
    judgeDenied(await observe(BIN, () => AC2_CASES, stoppedHome));
  }, 900_000);
});
