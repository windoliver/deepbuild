import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { allEvents, appendClaude, claudeTranscript, dataOf, HOUR, mulberry32, openArchiveOn, openWorld, removeTemps, word, type World } from '../../../tests/acceptance/20/helpers.ts';

afterAll(removeTemps);

const rotateAsks = async (w: World) => (await allEvents(w.record, ['ask.created'])).filter((e) => /rotat/i.test(String(dataOf(e).question)));
const rng = mulberry32(randomBytes(4).readUInt32LE(0));
/** A fresh key in gitleaks' github-pat shape, new on every run. */
const fakeKey = (): string => `ghp_${word(rng, 36)}`;

describe('keys pasted by field name', () => {
  // A secret JSON field's value is masked with its quotes kept, as "[REDACTED]".
  it('keys each pasted key by itself, one under a JSON field among them, so the same keys pasted again ask nothing new', async () => {
    const [a, b] = [fakeKey(), fakeKey()];
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: `here is the config {"token": "${a}", "user": "bob"} and also api_key=${b} ok` }]);
      const archive = await openArchiveOn(w);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the message asks to rotate its keys').toBe(1);
      appendClaude(t, [{ uuid: 'm2', role: 'user', text: `again: {"token": "${a}"} and api_key=${b}` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the same two keys pasted again ask nothing new').toBe(1);
    } finally {
      await w.close();
    }
  }, 60_000);

  // Pasted JSON that was already escaped is escaped twice in the transcript line.
  it('keys each key of pasted escaped JSON by itself', async () => {
    const [a, b, c] = [fakeKey(), fakeKey(), fakeKey()];
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: `cfg {\\"token\\": \\"${a}\\"} then api_key=${b}` }]);
      const archive = await openArchiveOn(w);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the message asks to rotate its keys').toBe(1);
      appendClaude(t, [{ uuid: 'm2', role: 'user', text: `again {\\"token\\": \\"${a}\\"} api_key=${b}` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the same keys pasted again ask nothing new').toBe(1);
      // A new key, pasted plain and then escaped.
      appendClaude(t, [{ uuid: 'm3', role: 'user', text: `cfg {"token": "${c}"}` }, { uuid: 'm4', role: 'user', text: `cfg {\\"token\\": \\"${c}\\"}` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the new key asks once, escaped or not').toBe(2);
    } finally {
      await w.close();
    }
  }, 60_000);

  // A field-name mask hides whatever sits under a secret name; only what still reads as a key by itself asks.
  it('asks nothing for plain words, code and placeholders a field name masks, and still asks for a key beside them', async () => {
    const plain = 'def login(password: str, token: str = None): set API_KEY=$API_KEY, password=$db_pass, password: <your-password>, '
      + 'password=***, {"password": null}, {"password": 98765432}, login(password=self.password), password = DB_PASSWORD, '
      + 'token = await getToken(); password=hunter2 password=Summer(2024) password=%9xKq2Lmd print("Enter password: "); x = 1 '
      + 'and Authorization: Bearer <token> means what?';
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: plain }]);
      const archive = await openArchiveOn(w);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'plain words, code and placeholders ask nothing').toBe(0);
      appendClaude(t, [{ uuid: 'm2', role: 'user', text: `password=${fakeKey()} then ${plain}` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the key beside them asks').toBe(1);
    } finally {
      await w.close();
    }
  }, 60_000);

  // A field's value can run past its key, as a form body's does, and masks can touch.
  it('keys the key inside a masked value, so text around it, a quote the mask did not open or a mask beside it asks nothing new', async () => {
    const [a, b, c] = [fakeKey(), fakeKey(), fakeKey()];
    const around = [`curl -d "token=${a}&scope=repo" https://api.x`, `set token=“${a}” in the env`, `token=<${a}>`, `token=${a}#frag`,
      `token=${a}|grep`, `TOKEN=${a}&x=1`, `Authorization: Bearer ${a}`, `token=${a}.`];
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm0', role: 'user', text: `my token is ${a}` }]);
      const archive = await openArchiveOn(w);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the key asks').toBe(1);
      appendClaude(t, around.map((text, n) => ({ uuid: `a${n}`, role: 'user' as const, text })));
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the same key with text around it asks nothing new').toBe(1);
      appendClaude(t, [{ uuid: 'm1', role: 'user', text: `token=${a}"${b}" tail` }, { uuid: 'm2', role: 'user', text: `secret: "${c}` }, { uuid: 'm3', role: 'user', text: `again ${b} and ${c}` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'each new key asks once, beside another mask or after a quote').toBe(3);
    } finally {
      await w.close();
    }
  }, 60_000);

  // A rule that finds a key by the word before it still asks when no field name masks it; one deep line costs one pass.
  it('asks for a key a pattern finds by its context, and for keys after a line of a thousand nested names', async () => {
    const [a, b] = [fakeKey(), fakeKey()];
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: `${'token='.repeat(4000)}${a}` }, { uuid: 'm2', role: 'user', text: `and ${b}` }]);
      const archive = await openArchiveOn(w);
      const started = performance.now();
      await archive.pass();
      expect(performance.now() - started, 'the deep line is read in one pass').toBeLessThan(5_000);
      expect((await rotateAsks(w)).length, 'the key under the deep line and the key after it each ask').toBe(2);
      appendClaude(t, [{ uuid: 'm3', role: 'user', text: 'heroku api: 01234567-89ab-cdef-0123-456789abcdef' }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the heroku key asks').toBe(3);
    } finally {
      await w.close();
    }
  }, 60_000);

  // Two rules can match one key, one with the text around it, as a curl user or a generic assignment does.
  it('asks once for a key two rules match, and keys it by itself', async () => {
    const [a, b] = [fakeKey(), fakeKey()];
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: `my keys are ${a} and ${b}` }]);
      const archive = await openArchiveOn(w);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the keys ask').toBe(1);
      appendClaude(t, [{ uuid: 'm2', role: 'user', text: `curl -u deploy:${a} https://api.example.com` }, { uuid: 'm3', role: 'user', text: `creds=${b}.prod` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the same keys inside a wider match ask nothing new').toBe(1);
      // A key-shaped user with a new password beside it is a new secret.
      appendClaude(t, [{ uuid: 'm4', role: 'user', text: `curl -u ${a}:${word(rng, 20)}7 https://api.example.com` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'a new password beside a known key asks').toBe(2);
    } finally {
      await w.close();
    }
  }, 60_000);

  it('keys a pasted key the same at the end of a sentence and in the middle of one', async () => {
    const key = fakeKey();
    const w = await openWorld();
    try {
      const t = claudeTranscript(w.env, [{ uuid: 'm1', role: 'user', text: `my login is token=${key}.` }]);
      const archive = await openArchiveOn(w);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the message asks to rotate its key').toBe(1);
      appendClaude(t, [{ uuid: 'm2', role: 'user', text: `again token=${key} here` }]);
      w.clock.tick(HOUR);
      await archive.pass();
      expect((await rotateAsks(w)).length, 'the same key pasted again asks nothing new').toBe(1);
    } finally {
      await w.close();
    }
  }, 60_000);
});
