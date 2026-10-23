// Output scrubbed by value before its digest (design, Privacy): AC6, a credential env-local loaded for the check is
// replaced in its stored output, raw and in base64; AC14, short plain values passed in (NODE_ENV=test, a leased
// PORT=3000) stay, so the failure's place and the address read as the tool wrote them.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, openWorld, outputOf, project, sha256, VITEST, type World } from './helpers.ts';
import { scrubsEveryPassedValue } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** Every base64 token in the text, decoded in both alphabets. */
function decodedTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9+/_-]{8,}={0,2}/g)) {
    out.push(Buffer.from(m[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'));
  }
  return out;
}

describe('AC6 #30.12fb4acb a check that prints a credential env-local loaded for it stores its output with the value replaced, in raw and base64 forms', () => {
  it('AC6 the credential appears nowhere in the stored output or the record, raw or base64 at any offset, in either alphabet; the words around it stay, and the digest is of the scrubbed output', async () => {
    const credential = `dh30${randomBytes(14).toString('hex')}`;
    const r = await runCommandCheck(command(world.sup, project('secret'), VITEST, { secrets: { SHOP_API_KEY: credential } }));
    expect(r.outcome, outputOf(r)).toBe('passed');
    const stored = outputOf(r);
    for (const word of ['raw', 'base64', 'base64+1', 'base64+2', 'base64url']) expect(stored, `the line that printed the ${word} form is kept`).toMatch(new RegExp(`${word.replace('+', '\\+')} \\S+ end`));
    expect(stored, 'the raw value').not.toContain(credential);
    for (const form of [Buffer.from(credential).toString('base64'), Buffer.from(credential).toString('base64url')]) expect(stored, `the base64 form ${form}`).not.toContain(form);
    expect(decodedTokens(stored).filter((t) => t.includes(credential)), 'a base64 token in the output that decodes to the credential').toEqual([]);
    expect(stored, 'the value is replaced, not dropped').toMatch(/raw \[redacted\] end/i);
    expect(JSON.stringify(r), 'the value in the run record').not.toContain(credential);
    expect(r.env, 'the credential\'s name is listed, never its value').toContain('SHOP_API_KEY');
    expect(r.output.sha256.stdout, 'the digest is of the scrubbed stdout').toBe(sha256(r.output.stdout));
  }, 180_000);
});

describe('AC14 #30.4df04268 short plain values passed in stay: the output keeps src/cart.test.ts:30:5 and localhost:3000, so the FAIL names that file and line', () => {
  const passed = { NODE_ENV: 'test', PORT: '3000' };

  /** The criterion's assertion on one run of the cart check. */
  function keepsPlainValues(r: CommandRun): void {
    const stored = outputOf(r);
    expect(stored.includes('src/cart.test.ts:30:5'), `the stored output names the failing line as the tool wrote it, src/cart.test.ts:30:5 (it shows ${stored.match(/src\/cart\.[^\s:]*:30:\d+/)?.[0] ?? 'no such line'})`).toBe(true);
    expect(stored.includes('localhost:3000'), `the stored output keeps localhost:3000 (it shows ${stored.match(/localhost:\S+/)?.[0] ?? 'no address'})`).toBe(true);
  }

  it('AC14 a Vitest check given NODE_ENV=test and a leased PORT=3000, whose test fails at src/cart.test.ts:30, records its test count and stores its output with both unchanged', async () => {
    const r = await runCommandCheck(command(world.sup, project('cart'), VITEST, { env: passed }));
    expect(r.outcome).toBe('failed');
    expect(r.testsRun, 'the cart suite\'s three tests').toBe(3);
    keepsPlainValues(r);
    expect(r.failures.find((f) => /totals the prices/.test(f.test)), 'the failure is placed at src/cart.test.ts:30').toMatchObject({ file: 'src/cart.test.ts', line: 30 });
    expect(r.env).toEqual(expect.arrayContaining(['NODE_ENV', 'PORT']));
  }, 180_000);

  it('AC14 (wrong program) a scrub of every passed value turns them into src/cart.[redacted].ts and localhost:[redacted], and fails this test, naming the line', async () => {
    const r = await runCommandCheck(command(world.sup, project('cart'), VITEST, { env: passed }));
    const wrong = scrubsEveryPassedValue(r, passed);
    expect(outputOf(wrong)).toMatch(/src\/cart\.\[redacted\]\.ts:30:5/);
    expect(outputOf(wrong)).toMatch(/localhost:\[redacted\]/);
    expect(() => keepsPlainValues(wrong)).toThrow(/src\/cart\.test\.ts:30:5/);
  }, 180_000);
});
