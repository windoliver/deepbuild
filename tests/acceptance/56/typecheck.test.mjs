// #56: the agent-written code passes tsc and the Effect diagnostics within two rounds of fixes, and
// errors name the DeepBuild file and line. tsc and the Effect diagnostics run through
// `node spikes/hub-core/typecheck.mjs --variant <v>`; a planted file proves each one really runs.
// A runtime failure is provoked through the hub's socket. The count of fix rounds is the record's.
// Run: node --test --test-concurrency=1 tests/acceptance/56/typecheck.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { FIX_ROUNDS, hex, hold, results, root, setup, show, SPIKE, spike, VARIANTS, within } from './helpers.mjs';

const ID = '#56.6526364c';

function typecheck(variant) {
  const result = spike('typecheck.mjs', ['--variant', variant], { timeout: 300_000 });
  const summary = result.objects.find((object) => object.variant === variant && 'errors' in object && !('file' in object));
  const diagnostics = result.objects.filter((object) => typeof object.tool === 'string' && 'file' in object && 'line' in object);
  return { result, summary, diagnostics };
}

const absolute = (file) => {
  const path = String(file).replace(/^file:\/\//, '');
  const full = isAbsolute(path) ? path : resolve(root, path);
  return existsSync(full) ? realpathSync(full) : full;
};

// A file planted in the variant's own source folder, removed when the test ends.
function plant(t, variant, source) {
  const path = join(root, SPIKE, variant, `zz-planted-56-${hex()}.ts`);
  writeFileSync(path, source);
  t.after(() => rmSync(path, { force: true }));
  return realpathSync(path);
}

for (const variant of VARIANTS) {
  test(`${ID} [${variant}] the agent-written code passes tsc${variant === 'effect' ? ' and the Effect diagnostics' : ''}`, { timeout: 300_000 }, () => {
    const { result, summary } = typecheck(variant);
    assert.ok(summary, `typecheck prints a summary line for ${variant}\n${show(result)}`);
    assert.equal(summary.errors, 0, show(result));
    assert.equal(result.status, 0, show(result));
    const tools = variant === 'effect' ? ['effect', 'tsc'] : ['tsc'];
    assert.deepEqual([...(summary.tools ?? [])].sort(), tools, `the summary names the tools that ran: ${JSON.stringify(summary)}`);
  });

  test(`${ID} [${variant}] a type error in the slice fails tsc, naming its file and line`, { timeout: 300_000 }, (t) => {
    const planted = plant(t, variant, '// planted by the #56 acceptance tests\nexport const planted: number = "not a number";\n');
    const { result, summary, diagnostics } = typecheck(variant);
    assert.notEqual(result.status, 0, `a type error must fail the typecheck\n${show(result)}`);
    assert.ok(summary?.errors >= 1, show(result));
    assert.ok(diagnostics.some(({ tool, file, line, severity }) => tool === 'tsc' && absolute(file) === planted && line === 2 && severity === 'error'),
      `tsc names ${relative(root, planted)} line 2\n${show(result)}`);
  });

  test(`${ID} [${variant}] a failure inside the slice comes back naming the slice's own source file and line`, { timeout: 60_000 }, async (t) => {
    const { hub, fx } = await setup(t, variant);
    const missing = join(fx.directory, `no-such-check-${hex()}`);
    const handle = hold(hub.socket, { id: 'missing-binary', session: 's0', argv: [missing] });
    const reply = await within(handle.reply, 5000, 'the reply to a hold whose check cannot start');
    assert.equal(reply.outcome, 'blocked', `a check that can't start is BLOCKED, never a pass or a fail: ${JSON.stringify(reply)}`);
    const text = `${reply.error?.message ?? ''}\n${reply.error?.stack ?? ''}`;
    const folder = join(root, SPIKE, variant);
    const pattern = /(?:file:\/\/)?(\/[^\s()'"]+?\.ts):(\d+)(?::\d+)?/g;
    const named = [...text.matchAll(pattern)].map(([, file, line]) => ({ file: absolute(file), line: Number(line) }))
      .filter(({ file }) => file.startsWith(`${folder}/`) && !file.includes('/node_modules/'));
    assert.ok(named.length, `the error names a .ts file of the ${variant} slice, with its line, not only Node's or Effect's internals: ${JSON.stringify(reply.error)}`);
    for (const { file, line } of named) {
      assert.ok(existsSync(file), `the named file exists: ${file}`);
      assert.ok(line >= 1 && line <= readFileSync(file, 'utf8').split('\n').length, `${relative(root, file)} has a line ${line}`);
    }
  });
}

test(`${ID} [effect] the Effect diagnostics run beside tsc: a floating Effect is reported at its file and line, though tsc accepts it`, { timeout: 300_000 }, (t) => {
  const planted = plant(t, 'effect', '// planted by the #56 acceptance tests\nimport { Effect } from "effect";\nexport function planted(): void {\n  Effect.log("never run");\n}\n');
  const { result, diagnostics } = typecheck('effect');
  const here = diagnostics.filter(({ file }) => absolute(file) === planted);
  assert.ok(here.some(({ tool, line }) => tool === 'effect' && line === 4), `the Effect diagnostics name ${relative(root, planted)} line 4\n${show(result)}`);
  assert.ok(!here.some(({ tool }) => tool === 'tsc'), `tsc itself has nothing to say about a floating Effect, so the report came from the Effect diagnostics\n${show(result)}`);
});

test(`${ID} both builds were written by one agent from one prompt, each within two rounds of fixes`, () => {
  const record = results();
  assert.equal(typeof record.prompt, 'string', `the record names the prompt file: ${JSON.stringify(record.prompt)}`);
  const prompt = join(root, record.prompt);
  assert.ok(existsSync(prompt) && readFileSync(prompt, 'utf8').trim().length > 0, `the prompt both builds came from is kept: ${record.prompt}`);
  const [plain, effect] = VARIANTS.map((variant) => record.variants?.[variant]);
  for (const [variant, entry] of [['plain', plain], ['effect', effect]]) {
    assert.ok(entry && typeof entry.agent === 'string' && entry.agent && typeof entry.model === 'string' && entry.model, `the record names the agent and model that wrote ${variant}: ${JSON.stringify(entry)}`);
    assert.ok(Number.isSafeInteger(entry.fixRounds) && entry.fixRounds >= 0, `the record counts ${variant}'s rounds of fixes: ${JSON.stringify(entry)}`);
    assert.ok(entry.fixRounds <= FIX_ROUNDS, `${variant} passed tsc${variant === 'effect' ? ' and the Effect diagnostics' : ''} within two rounds of fixes: ${entry.fixRounds}`);
  }
  assert.deepEqual([plain.agent, plain.model], [effect.agent, effect.model], 'the same agent and model wrote both');
});
