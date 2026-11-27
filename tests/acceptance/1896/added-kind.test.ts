// #1896 AC1: a work kind added to checks-work in a test is offered by the hub with no edit to kinds.ts. The test lays
// a changed copy of checks-work's sources in a temporary folder, with a fifth kind, `parcel`, added wherever those
// sources list the four (README, The AC1 mechanism), stands the copy in for `@deepbuild/checks-work`, and asks the
// hub's own table, `openKinds(...).list()`, which `checks.kinds` answers from, what it offers. packages/hub is read as
// it is: nothing of it is copied, changed or stood in for.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, expect, it, vi } from 'vitest';

const AC1 = '#1896.6e954ac7';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OWNER = join(ROOT, 'packages/checks-work/src');
/** checks-work's kinds at the base, and the one this test adds. */
const FOUR = ['service', 'data', 'document', 'message'];
const ADDED = 'parcel';

const nameOf = (p: ts.ObjectLiteralElementLike): string | undefined =>
  p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : undefined;
const literal = (e: ts.Node | undefined): string | undefined => {
  while (e && (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression;
  return e && ts.isStringLiteralLike(e) ? e.text : undefined;
};
/** A list's element as the kind it stands for: the kind's name, a tuple that starts with it, or a record with a field that holds it. */
const kindOf = (e: ts.Expression): string | undefined => {
  const own = literal(e);
  if (own !== undefined) return own;
  if (ts.isArrayLiteralExpression(e)) return literal(e.elements[0]);
  if (ts.isObjectLiteralExpression(e)) return e.properties.map((p) => (ts.isPropertyAssignment(p) ? literal(p.initializer) : undefined)).find((k) => k !== undefined && FOUR.includes(k));
  return undefined;
};
const holdsFour = (names: (string | undefined)[]): boolean => FOUR.every((k) => names.includes(k));

/**
 * `text` with the fifth kind beside `message` wherever it lists the four kinds: an object literal keyed by all four
 * gets `parcel: <message's value>`; a list of all four (names, tuples that start with the name, or records holding
 * it) gets message's element again with the name `parcel`. The places changed, as line numbers.
 */
function withFifth(file: string, text: string): { text: string; lines: number[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits: { at: number; insert: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && holdsFour(node.properties.map(nameOf))) {
      const message = node.properties.find((p) => nameOf(p) === 'message')!;
      const value = ts.isPropertyAssignment(message) ? message.initializer.getText(source) : ts.isShorthandPropertyAssignment(message) ? 'message' : undefined;
      if (value !== undefined) edits.push({ at: message.getEnd(), insert: `, ${ADDED}: ${value}` });
    }
    if (ts.isArrayLiteralExpression(node) && holdsFour(node.elements.map(kindOf))) {
      const message = node.elements.find((e) => kindOf(e) === 'message')!;
      edits.push({ at: message.getEnd(), insert: `, ${message.getText(source).replace(/(['"`])message\1/, `'${ADDED}'`)}` });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let out = text;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.insert + out.slice(e.at);
  return { text: out, lines: edits.map((e) => source.getLineAndCharacterOfPosition(e.at).line + 1).sort((a, b) => a - b) };
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(?:ts|mts|cts)$/.test(e.name) && !/\.d\.ts$|\.test\.ts$|\.spec\.ts$/.test(e.name) ? [path] : [];
  });
}

const made: string[] = [];
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** The changed copy: checks-work's sources with the fifth kind, in a folder whose packages resolve as the repo's do. */
function changedCopy(): { entry: string; added: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1896-'));
  made.push(dir);
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir');
  const added: string[] = [];
  for (const file of sources(OWNER)) {
    const to = join(dir, 'src', relative(OWNER, file));
    const changed = withFifth(file, readFileSync(file, 'utf8'));
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, changed.text);
    added.push(...changed.lines.map((line) => `${relative(ROOT, file)}:${line}`));
  }
  return { entry: join(dir, 'src', 'index.ts'), added };
}

it(`${AC1} a fifth work kind added to checks-work alone is offered by the hub, on the route its other work kinds have`, async () => {
  const copy = changedCopy();
  vi.doMock('@deepbuild/checks-work', () => import(/* @vite-ignore */ copy.entry));

  // The owner's side: the changed checks-work itself holds the fifth kind, as its plug-in registers its kinds.
  const owner = await import('@deepbuild/checks-work') as unknown as { default(deep: { registerCheck(type: string, runner: unknown): void }): void };
  const registered: string[] = [];
  owner.default({ registerCheck: (type) => { registered.push(type); } });

  // The hub's side, through its own table. list() and definitionSpec() read the table alone, so no option is reached.
  const { openKinds } = await import('../../../packages/hub/src/kinds.ts');
  const kinds = await openKinds({ host: () => { throw Error('no run is asked for'); }, extensions: () => undefined, plant: undefined } as unknown as Parameters<typeof openKinds>[0]);
  const offered = kinds.list();
  const routes = (kind: string): string | undefined => { const held = offered.find((k) => k.kind === kind); return held && JSON.stringify(held.routes); };
  const named = kinds.definitionSpec(Buffer.from(JSON.stringify({ kind: ADDED, runner: 'post', inputs: [], depth: 'unit', oracle: 'code', contract: null })));

  const summary = {
    addedToChecksWorkAlone: copy.added.length > 0,
    checksWorkRegisters: [...registered].sort(),
    workKindsTheHubLacks: registered.filter((k) => !offered.some((o) => o.kind === k)),
    parcelIsRouted: routes(ADDED) === undefined ? 'not offered' : routes(ADDED) === routes('message') ? 'as message is' : `otherwise: ${routes(ADDED)}`,
    aDefinitionMayNameParcel: named?.kind === ADDED,
  };
  expect(summary, `added at ${copy.added.join(', ') || 'no place'}; the hub offers ${offered.map((k) => k.kind).join(', ')}`).toEqual({
    addedToChecksWorkAlone: true,
    checksWorkRegisters: [...FOUR, ADDED].sort(),
    workKindsTheHubLacks: [],
    parcelIsRouted: 'as message is',
    aDefinitionMayNameParcel: true,
  });
}, 30_000);
