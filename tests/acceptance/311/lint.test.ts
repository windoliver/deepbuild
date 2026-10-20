import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { canonicalize, generateTypeScript, lintSchemas, listSchemas, registry } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { fixtureSet, utf8 } from './helpers.ts';
import type { LintFixture, NodeFixture } from './helpers.ts';

const NODES = fixtureSet<NodeFixture>('nodes');
const PLANTED = fixtureSet<LintFixture>('lint');

describe('AC22 every contract schema uses only the closed node types', () => {
  it('AC22 the published contract schemas pass the preflight lint', () => {
    expect(lintSchemas(listSchemas())).toEqual([]);
  });

  it('AC22 one fixture schema per node type passes the lint', () => {
    expect(NODES.length).toBe(14);
    for (const node of NODES) expect(lintSchemas([{ name: node.name, schema: node.schema }]), node.node).toEqual([]);
  });

  it.each(PLANTED.map((p) => [p.name, p] as const))('AC22 %s fails the preflight, naming the schema and the path', (name, planted) => {
    const problems = lintSchemas([{ name, schema: planted.schema }]);
    // A lint that reads only `type` keywords passes the anyOf schema and fails here.
    expect(problems.length, `${name} is refused`).toBeGreaterThan(0);
    expect(problems.every((p) => p.schema === name), `${name}: every problem names the schema`).toBe(true);
    expect(problems.some((p) => p.path.startsWith(planted.path)), `${name}: a problem names ${planted.path}: ${JSON.stringify(problems)}`).toBe(true);
    expect(problems.every((p) => p.reason.length > 0)).toBe(true);
  });

  it('AC22 annotations stay free: description, title, examples and $comment never fail the lint', () => {
    const annotated = NODES.map((n) => ({ name: n.name, schema: { ...n.schema, title: n.name, description: n.node, $comment: 'free', examples: [] } }));
    expect(lintSchemas(annotated)).toEqual([]);
  });

  it('AC22 each node type\'s fixtures round-trip through the TypeScript side to identical bytes', () => {
    const reg = registry(NODES.map((n) => ({ name: n.name, schema: n.schema })));
    for (const node of NODES) {
      for (const value of node.instances) {
        const want = utf8(canonicalize(value));
        expect(reg.validate(node.name, value).ok, `${node.name} ${want}`).toBe(true);
        expect(reg.encode(node.name, reg.decode(node.name, JSON.stringify(value))), `${node.name} ${want}`).toBe(want);
      }
    }
  });

  it('AC22 the node-type schemas generate TypeScript that type-checks under strict options and has no runtime code', () => {
    const source = generateTypeScript(NODES.map((n) => ({ name: n.name, schema: n.schema })));
    const dir = mkdtempSync(join(tmpdir(), 'deep-311-ts-'));
    try {
      const file = join(dir, 'nodes.ts');
      writeFileSync(file, source);
      const program = ts.createProgram([file], {
        strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true,
        target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
        skipLibCheck: true, types: [],
      });
      const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      expect(diagnostics).toEqual([]);
      const js = ts.transpileModule(source, { compilerOptions: { removeComments: true, module: ts.ModuleKind.ESNext } }).outputText.trim();
      expect(['', 'export {};']).toContain(js);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC22 a value outside a node type is refused by that node\'s schema', () => {
    const reg = registry(NODES.map((n) => ({ name: n.name, schema: n.schema })));
    const outside: Record<string, JsonValue> = {
      'fixture.node.object@1': { name: 'a', extra: 1 },
      'fixture.node.map@1': { Upper: 1 },
      'fixture.node.array@1': [1],
      'fixture.node.string-pattern@1': 'ABC-12',
      'fixture.node.string-length@1': 'abcdefghi',
      'fixture.node.string-enum@1': 'deny',
      'fixture.node.string-format@1': 'not-a-ulid',
      'fixture.node.integer@1': 65536,
      'fixture.node.number@1': 1.75,
      'fixture.node.boolean@1': 'true',
      'fixture.node.constant@1': 'other',
      'fixture.node.nullable@1': -1,
      'fixture.node.union@1': { kind: 'mcp', command: 'ls' },
      'fixture.node.reference@1': [''],
    };
    for (const node of NODES) {
      expect(Object.hasOwn(outside, node.name), node.name).toBe(true);
      expect(reg.validate(node.name, outside[node.name]!).ok, `${node.name} refuses ${JSON.stringify(outside[node.name])}`).toBe(false);
    }
  });
});
