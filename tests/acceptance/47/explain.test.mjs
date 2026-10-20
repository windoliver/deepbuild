// #47 acceptance: `deep explain <session>` on a recorded session of the corpus, run as the CLI entry
// the way packages/cli/test/cli.test.ts runs it. Run: node --test 'tests/acceptance/47/*.test.mjs'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AGENTS, ID, readFacts, requireCorpus, root, sessions, setDir, show } from './helpers.mjs';

const deep = (...args) => spawnSync(process.execPath, [join(root, 'packages/cli/src/main.ts'), ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 });

/** RFC 6901: the value a JSON Pointer names, or undefined. */
function pointer(document, path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return undefined;
  return path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), document);
}

test(`${ID.explain} deep explain <session> names, for each event, the facts rule that mapped it and the agent version behind it`, () => {
  const probe = deep('explain', 'no-such-session');
  assert.doesNotMatch(`${probe.stdout}${probe.stderr}`, /Unsupported command/, `deep explain is not a command yet\n${show(probe)}`);
  requireCorpus();
  for (const agent of AGENTS) {
    const { facts } = readFacts(agent);
    // The earliest covered version, so one that prints the newest covered or installed version fails.
    const version = facts.versions[0];
    // A session whose payloads come from more than one hook, so one rule for every event shows.
    const session = sessions({ agent, version, dir: setDir(agent, version) }).find((one) => new Set(one.cases.map((found) => found.payload.hook_event_name)).size > 1);
    assert.ok(session, `${agent} ${version}: no recorded session with two kinds of hook`);
    const result = deep('explain', session.dir, '--json');
    assert.equal(result.status, 0, show(result));
    const lines = result.stdout.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
    const rulesByHook = new Map();
    for (const recorded of session.cases) {
      const mine = lines.filter((line) => line.line === recorded.line);
      assert.deepEqual(mine.map((line) => line.kind), recorded.expect.map((event) => event.kind), `${agent} events.jsonl:${recorded.line}: one line per event it maps to\n${show(result)}`);
      for (const line of mine) {
        assert.equal(line.hook, recorded.payload.hook_event_name, JSON.stringify(line));
        assert.equal(line.version, version, `the agent version behind the event: ${JSON.stringify(line)}`);
        assert.equal(line.facts, `adapters/${agent}.facts.json`, JSON.stringify(line));
        const named = JSON.parse(readFileSync(join(root, line.facts), 'utf8'));
        assert.notEqual(pointer(named, line.rule), undefined, `the rule is a JSON Pointer into ${line.facts}: ${JSON.stringify(line)}`);
        rulesByHook.set(line.hook, new Set([...(rulesByHook.get(line.hook) ?? []), line.rule]));
      }
    }
    const hooks = [...rulesByHook.keys()];
    assert.ok(hooks.length > 1, `${agent}: explain covered more than one hook`);
    const [first, second] = hooks.map((hook) => [...rulesByHook.get(hook)].join('|'));
    assert.notEqual(first, second, `${agent}: ${hooks[0]} and ${hooks[1]} are mapped by different rules, not one name for all: ${JSON.stringify(Object.fromEntries([...rulesByHook].map(([hook, rules]) => [hook, [...rules]])))}`);
  }
});
