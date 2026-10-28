import { afterEach, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { TextRequest } from '../../../packages/evidence/src/index.ts';
import { anyUse, filesContaining, removeRoots, storeText, stored, T0, tempRoot, text } from '../15/helpers.ts';

afterEach(removeRoots);

// Values the hub never injected: no scrub list names them, so only a rule keyed on the field's name can find them.
const log: TextRequest = { kind: 'log', source: 'run:761', redaction: 'complete', license: anyUse, run: { held: [] } };
const runner = { role: 'deepbuild', via: 'job' } as const;

async function storeAlone(output: string) {
  const root = tempRoot();
  const store = await openEvidenceStore({ root, now: () => T0 });
  const hash = stored(await storeText(store.connect(runner), log, [output]));
  return { root, out: text(await store.read(hash)) };
}

interface Secret {
  /** The line as the test prints it. */
  printed: string;
  /** The field name and its separator, which the stored line keeps. */
  name: string;
  /** Every part of the value, none of which may stay after the name. */
  value: string[];
  /** The value's distinctive parts, which no file under the store's root may hold. */
  onDisk: string[];
}

// The issue's nine lines. Header rule: the whole value after the header name goes, to the end of the line.
// Auth-scheme rule: a value that starts with a scheme goes to the end of the line.
const T = 'q7Zp2LmX9vR4tY8w';
const nine: Secret[] = [
  { printed: `Authorization: Bearer ${T}`, name: 'Authorization:', value: ['Bearer', T], onDisk: [T] },
  { printed: 'Proxy-Authorization: Basic dXNlcjpodW50ZXIy', name: 'Proxy-Authorization:', value: ['Basic', 'dXNlcjpodW50ZXIy'], onDisk: ['dXNlcjpodW50ZXIy'] },
  { printed: `Cookie: sid=${T}; theme=dark`, name: 'Cookie:', value: ['sid', T, 'theme', 'dark'], onDisk: [T, 'theme=dark'] },
  { printed: `Set-Cookie: sid=${T}; Path=/`, name: 'Set-Cookie:', value: ['sid', T, 'Path'], onDisk: [T, 'Path=/'] },
  { printed: `access_token=Bearer ${T}`, name: 'access_token=', value: ['Bearer', T], onDisk: [T] },
  { printed: `token=Bot ${T}.sig_part-2`, name: 'token=', value: ['Bot', T, 'sig_part', 'part-2'], onDisk: [T, 'sig_part-2'] },
  { printed: 'password: "hunter two words"', name: 'password:', value: ['hunter', 'two', 'words'], onDisk: ['hunter two words'] },
  { printed: '{"password":"hunter2"}', name: '{"password":', value: ['hunter2'], onDisk: ['hunter2'] },
  // JSON escaped once inside a string: the backslashes are in the printed text.
  { printed: `{\\"client_secret\\":\\"${T}\\"}`, name: '{\\"client_secret\\":', value: [T], onDisk: [T] },
];

// The four twins: names whose parts hold no secret word, and prose that only mentions a header's name.
const four = ['"input_tokens": 1234', '"max_tokens": 4096', 'tokenizer=cl100k', 'Authorization required for this route'];

/** Why a stored line didn't scrub its value and keep its name, or undefined when it did. */
function problem(secret: Secret, storedLine: string, root?: string): string | undefined {
  const at = storedLine.indexOf(secret.name);
  if (at < 0) return `the field name ${secret.name} was not kept`;
  const after = storedLine.slice(at + secret.name.length);
  const kept = secret.value.filter((part) => after.includes(part));
  if (kept.length) return `kept ${kept.map((part) => JSON.stringify(part)).join(', ')} of its value`;
  if (!after.trim()) return 'the value was deleted, not replaced';
  const onDisk = root ? secret.onDisk.flatMap((part) => filesContaining(root, part).map((file) => `${JSON.stringify(part)} in ${file}`)) : [];
  if (onDisk.length) return `left ${onDisk.join('; ')}`;
  return undefined;
}

const show = (pairs: [string, string][]) => console.log(pairs.map(([printed, out]) => `printed: ${printed}\nstored:  ${out}`).join('\n'));

describe('AC1 #761.609597be each of the nine lines, with values the hub never injected, is stored with every value replaced and every field name kept', () => {
  it('AC1 each line stored alone loses its whole value and keeps its field name, in the stored bytes and in every file under the root', async () => {
    const failures: string[] = [];
    const pairs: [string, string][] = [];
    for (const secret of nine) {
      const { root, out } = await storeAlone(`${secret.printed}\n`);
      pairs.push([secret.printed, out.replace(/\n$/, '')]);
      const why = problem(secret, out, root);
      if (why) failures.push(`${secret.printed} was stored as ${JSON.stringify(out)}: ${why}`);
    }
    show(pairs);
    expect(failures[0], `the first line that kept its value: ${failures[0]} (${failures.length} of 9 failed)`).toBeUndefined();
  });
});

describe('AC2 #761.542dabc6 names whose parts hold no secret word, and prose naming a header, are stored unchanged', () => {
  it('AC2 "input_tokens": 1234, "max_tokens": 4096, tokenizer=cl100k and the prose line are stored byte for byte', async () => {
    const changed: string[] = [];
    const pairs: [string, string][] = [];
    for (const line of four) {
      const { out } = await storeAlone(`${line}\n`);
      pairs.push([line, out.replace(/\n$/, '')]);
      if (out !== `${line}\n`) changed.push(`${line} was stored as ${JSON.stringify(out)}`);
    }
    show(pairs);
    expect(changed[0], `the first line not stored unchanged: ${changed[0]} (${changed.length} of 4 changed)`).toBeUndefined();
  });
});

describe('AC1 #761.609597be AC2 #761.542dabc6 the nine lines and their four twins printed together in one log', () => {
  it('AC1 AC2 in one log, each of the nine is scrubbed to the end of its own line only and each of the four stays byte for byte', async () => {
    const lines = [...nine.map((secret) => secret.printed), ...four];
    const { root, out } = await storeAlone(`${lines.join('\n')}\n`);
    const got = out.split('\n');
    show(lines.map((line, k) => [line, got[k] ?? '(missing)']));
    expect(got.length, `the stored log has ${got.length - 1} lines, not ${lines.length}: ${JSON.stringify(out)}`).toBe(lines.length + 1);
    const failures: string[] = [];
    for (const [k, secret] of nine.entries()) {
      const why = problem(secret, got[k]!);
      if (why) failures.push(`${secret.printed} was stored as ${JSON.stringify(got[k])}: ${why}`);
    }
    for (const [k, line] of four.entries()) if (got[nine.length + k] !== line) failures.push(`${line} was stored as ${JSON.stringify(got[nine.length + k])}: changed`);
    // The files under the root hold all thirteen lines, so they are searched once, after each line is judged.
    for (const part of new Set(nine.flatMap((secret) => secret.onDisk))) for (const file of filesContaining(root, part)) failures.push(`${JSON.stringify(part)} is on disk in ${file}`);
    expect(failures[0], `the first line that failed: ${failures[0]} (${failures.length} problems in all)`).toBeUndefined();
  });
});
