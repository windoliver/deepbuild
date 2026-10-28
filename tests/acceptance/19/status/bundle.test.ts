// #19.a34ae696 (AC7): the debug bundle contains no secret-shaped strings. `deep debug bundle` holds redacted logs,
// versions and doctor output (Scope). Secret-shaped strings are planted everywhere those come from: a key for every
// rule of the pinned gitleaks default config (#15's fixture, tests/acceptance/15/gitleaks.ts) in the hub's log, the
// control token, billing keys in the environment `deep` runs in, an OTLP endpoint and header with keys in Claude
// Code's settings env, and key-shaped text in what `claude auth status` and `codex login status` print (the doctor's
// sign-in items read both; design: Plan usage, "The output of `codex login status` is never logged"). The bundle,
// inflated, must hold none of them, in any form, while it does hold the log's other lines and the doctor's items.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureFor, GITLEAKS_TAG, loadGitleaks, type Fixture } from '../../15/gitleaks.ts';
import { cleanup, deep, everyForm, makeHome, parse, readBundle, shown, type Bundle, type Home } from './helpers.ts';

afterEach(cleanup, 30_000);

const ID = 'AC7 #19.a34ae696';
const { rules, global } = loadGitleaks();
const fixtures: Fixture[] = rules.flatMap((rule, n) => { const f = fixtureFor(rule, global, 0x1907_0000 + n); return f ? [f] : []; });
const keyOf = (rule: string): string => {
  const f = fixtures.find((x) => x.rule === rule);
  if (!f) throw Error(`BLOCKED: no generated key for gitleaks rule ${rule}`);
  return f.secret;
};

interface Planted { name: string; value: string; forms: 'raw' | 'every' }
/** A home whose logs, settings, environment and stand-ins hold secret-shaped strings; what was planted where. */
function plant(h: Home): { env: Record<string, string>; planted: Planted[]; marker: string } {
  const marker = `marker-${randomBytes(6).toString('hex')} the bundle keeps this log line`;
  const token = randomBytes(32).toString('base64url');
  const anthropic = keyOf('anthropic-api-key');
  const openai = keyOf('openai-api-key');
  const github = keyOf('github-pat');
  const jwt = keyOf('jwt');
  const slack = keyOf('slack-bot-token');
  mkdirSync(join(h.root, 'logs'), { recursive: true, mode: 0o700 });
  // A stopped hub's control token, and its log: every rule's key on a line of its own, and the token printed raw.
  writeFileSync(join(h.root, 'control.token'), `${token}\n`, { mode: 0o600 });
  writeFileSync(join(h.root, 'logs', 'hub.log'), [
    `2026-10-27T09:00:00Z INFO ${marker}`,
    ...fixtures.map((f) => f.line.trimEnd()),
    `2026-10-27T09:00:02Z WARN a client presented ${token}`,
  ].join('\n') + '\n', { mode: 0o600 });
  // Claude Code's user settings, with telemetry pointed at an endpoint that carries a key, and keys in its env block.
  writeFileSync(join(h.home, '.claude', 'settings.json'), `${JSON.stringify({
    env: {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://deep:${github}@127.0.0.1:4318`, OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${jwt}`,
      SLACK_BOT_TOKEN: slack,
    },
  }, null, 2)}\n`);
  // What the sign-in commands print: a token-shaped field from claude, and Codex's API-key line with the key in it.
  writeFileSync(join(h.bin, 'claude.auth'), `${JSON.stringify({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY', key: anthropic })}\n`);
  writeFileSync(join(h.bin, 'codex.login'), `Logged in using an API key - ${openai}\n`);
  return {
    env: { ANTHROPIC_API_KEY: anthropic, OPENAI_API_KEY: openai, GITHUB_TOKEN: github },
    marker,
    planted: [
      ...fixtures.map((f): Planted => ({ name: `gitleaks ${GITLEAKS_TAG} rule ${f.rule}'s key in logs/hub.log`, value: f.secret, forms: 'raw' })),
      { name: 'the control token', value: token, forms: 'every' },
      { name: 'ANTHROPIC_API_KEY in the environment and in claude auth status', value: anthropic, forms: 'raw' },
      { name: 'OPENAI_API_KEY in the environment and in codex login status', value: openai, forms: 'raw' },
      { name: 'GITHUB_TOKEN in the environment and the OTLP endpoint in settings.json', value: github, forms: 'raw' },
      { name: 'the OTLP header in settings.json', value: jwt, forms: 'raw' },
      { name: 'SLACK_BOT_TOKEN in settings.json', value: slack, forms: 'raw' },
    ],
  };
}
/** Every planted string found in the bundle: `<what> (<form>)`. */
function found(bundle: Bundle, planted: readonly Planted[]): string[] {
  return planted.flatMap((p) => (p.forms === 'every' ? everyForm(p.value) : [{ name: 'raw', text: p.value }])
    .filter((f) => bundle.text.includes(f.text) || bundle.strings.includes(f.text)).map((f) => `${p.name} (${f.name}) in ${bundle.path}`));
}
async function makeBundle(h: Home, env: Record<string, string | undefined>): Promise<Bundle> {
  const made = await deep(h.home, ['debug', 'bundle'], { env });
  expect(made.code, `deep debug bundle exits 0: ${shown(made)}`).toBe(0);
  const path = made.stdout.trim().split('\n').at(-1) ?? '';
  expect(existsSync(path), `deep debug bundle prints the bundle's path last: ${made.stdout}`).toBe(true);
  return readBundle(path);
}

describe(`${ID} the debug bundle holds no secret-shaped string`, () => {
  it(`${ID} with a key for each of the ${fixtures.length} gitleaks rules in the logs, keys in the environment, in Claude Code's settings and in what the sign-in commands print, the bundle holds its logs and the doctor's output but none of the keys, in any form`, async () => {
    const h = makeHome();
    const { env, planted, marker } = plant(h);
    expect(fixtures.length, 'a key for every gitleaks rule with a pattern').toBe(rules.length - 1);

    const doctor = await deep(h.home, ['doctor', '--json'], { env });
    const items = doctor.stdout.split('\n').map(parse).filter((l): l is NonNullable<typeof l> => !!l && typeof l.fix === 'string');
    expect(items.length, `deep doctor --json prints its items: ${shown(doctor)}`).toBeGreaterThan(0);

    const bundle = await makeBundle(h, env);
    // What the bundle must hold, so the search below searches a bundle with the logs and the doctor's output in it.
    expect(bundle.text.includes(marker) || bundle.strings.includes(marker), `the bundle holds the hub log's lines (${marker})`).toBe(true);
    const missing = items.filter((i) => !bundle.strings.includes(i.fix) && !bundle.text.includes(i.fix)).map((i) => `${i.item ?? ''} ${i.code}: ${i.fix}`);
    expect(missing, 'the bundle holds the doctor\'s output: each item deep doctor --json prints, by its fix').toEqual([]);

    const hits = found(bundle, planted);
    // A bundle that copies a log, a setting, the environment or a sign-in command's output as it is fails here,
    // naming each key it kept and where it came from.
    expect(hits, `secret-shaped strings in the debug bundle:\n${hits.join('\n')}`).toEqual([]);
  }, 120_000);

  it(`${ID} (wrong program) a bundle that copies the logs unscrubbed, DEEP_CLI_PLANT=bundle-raw-logs, fails the search, naming the keys`, async () => {
    const h = makeHome();
    const { env, planted } = plant(h);
    const bundle = await makeBundle(h, { ...env, DEEP_CLI_PLANT: 'bundle-raw-logs' });
    const hits = found(bundle, planted);
    expect(hits.filter((x) => /gitleaks .* in logs\/hub\.log/.test(x)).length, `the planted bundle keeps the log's keys, and the search names them:\n${hits.slice(0, 5).join('\n')}`).toBeGreaterThan(0);
    expect(hits.some((x) => x.startsWith('the control token (raw)')), 'and the control token').toBe(true);
  }, 120_000);
});
