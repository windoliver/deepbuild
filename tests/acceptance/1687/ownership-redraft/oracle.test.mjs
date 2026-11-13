import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { callableLengths, capture, corePresent, parse, retained } from './source-oracles.mjs';

// All fixtures are ours, not product-code copies. The same algorithm changes location, not behavior.
const algorithm = '{ const out = []; for (const x of xs) { if (x > 0) out.push(x * 2); } return out; }';
const base = `class Core { deliver(xs) ${algorithm} }`;
const surface = { responsibility: 'delivery', label: 'Core.deliver', ...capture(parse(base), { owner: 'Core', name: 'deliver' }) };
const execute = (source) => runInNewContext(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText);
const result = (source) => JSON.stringify(execute(source));

function assertMoved(source) {
  assert.deepEqual(retained(parse(source), [surface]), [], 'old source still owns the selected algorithm');
}

test('ownership oracle: retained, renamed, nested and module-level bodies fail; fixture behavior stays equal', () => {
  const cases = [
    [base, 'new Core().deliver([-1, 2, 3])'],
    [`class Anything { other(xs) ${algorithm} }`, 'new Anything().other([-1, 2, 3])'],
    [`function helper(xs) ${algorithm}`, 'helper([-1, 2, 3])'],
    [`const helper = (xs) => ${algorithm};`, 'helper([-1, 2, 3])'],
    [`class Core { deliver(xs) { return (() => ${algorithm})(); } }`, 'new Core().deliver([-1, 2, 3])'],
    [`class Core { deliver(xs) { void 0; ${algorithm.slice(1, -1)} } }`, 'new Core().deliver([-1, 2, 3])'],
  ];
  for (const [source, call] of cases) {
    assert.equal(result(`${source}; ${call}`), '[4,6]');
    const violations = retained(parse(source), [surface]);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /delivery: Core\.deliver retained at line \d+/);
    assert.throws(() => assertMoved(source), /old source still owns/);
  }
});

test('ownership oracle: real movement allows arbitrary destination names, aliases, forwarding and re-exports', () => {
  const seam = `class Arbitrary { work(xs) ${algorithm} }`;
  const wiring = 'class Core { constructor() { this.part = new Arbitrary(); } deliver(xs) { return this.part.work(xs); } }';
  assert.equal(result(`${seam}; ${wiring}; new Core().deliver([-1, 2, 3])`), '[4,6]');
  assertMoved(`import { Arbitrary as Local } from './whatever.js';\n${wiring}`);
  assertMoved("export { deliver } from './other-name.js';");
  // Importing a correctly named seam while keeping the algorithm must not count as movement.
  assert.throws(() => assertMoved(`import { Delivery } from './delivery.js';\n${base}`), /old source still owns/);
});

test('ownership oracle: comments, strings, interfaces and call sites are not implementations', () => {
  assertMoved(`// ${base}\nconst example = ${JSON.stringify(base)}; interface API { deliver(xs: number[]): number[] }`);
  const trivia = base.replace('const out', '/* moved? */\n const out').replace('return out;', '// same algorithm\nreturn out;');
  assert.throws(() => assertMoved(trivia), /old source still owns/);
});

test('ownership oracle: expression-bodied functions and the actual send branch are captured', () => {
  const tree = parse("const subjectKey = (x) => JSON.stringify([x.kind, x.owner]); class Host { dispatchNow(x) { switch(x) { case 'deep.send': { const key = x; return key + '!'; } default: return ''; } } }");
  const key = { label: 'subjectKey', ...capture(tree, { name: 'subjectKey' }) };
  const send = { label: 'send branch', ...capture(tree, { owner: 'Host', name: 'dispatchNow', case: 'deep.send' }) };
  assert.equal(retained(tree, [key, send]).length, 2);
  assert.equal(retained(parse('const renamed = (x) => JSON.stringify([x.kind, x.owner]);'), [key]).length, 1);
  assert.equal(retained(parse("function renamed(x) { const key = x; return key + '!'; }"), [send]).length, 1);
  assert.deepEqual(retained(parse('export { subjectKey } from "./keys-anywhere.js";'), [key]), []);
});

// Physical source spans: first declaration token through closing token inclusive, no leading JSDoc.
function sized(open, close, lines) {
  return `${open}\n${Array.from({ length: lines - 2 }, () => 'void 0;').join('\n')}\n${close}`;
}
function assertShort(source) {
  assert.deepEqual(callableLengths(parse(source)).filter((entry) => entry.lines > 100), [], 'callable exceeds 100 source lines');
}

test('length oracle: every callable form passes at 100 and fails at 101, with executable twins', () => {
  const forms = [
    ['class Core {', 'm() {', '}', 'new Core().m()'],
    ['class Core {', 'constructor() {', '}', 'new Core()'],
    ['class Core {', 'get value() {', '}', 'new Core().value'],
    ['class Core {', 'set value(x) {', '}', 'new Core().value = 1'],
    ['class Core {', 'field = () => {', '}', 'new Core().field()'],
    ['class Core {', 'field = function () {', '}', 'new Core().field()'],
    ['const obj = {', "['computed']() {", '}', 'obj.computed()'],
    ['', 'function helper() {', '}', 'helper()'],
  ];
  for (const [outer, open, close, call] of forms) for (const lines of [100, 101]) {
    const source = `${outer}\n${sized(open, close, lines)}\n${outer ? '};' : ''}\n${call}; 42;`;
    assert.equal(execute(source), 42);
    assert.equal(callableLengths(parse(source))[0].lines, lines);
    if (lines === 100) assertShort(source);
    else assert.throws(() => assertShort(source), /exceeds 100 source lines/);
  }
});

test('length oracle: includes blank lines, internal comments, multiline signatures and nested callbacks, not leading docs', () => {
  const source = `/**\n${'outside\n'.repeat(120)}*/\nclass Core {\nprivate async m(\nx: number\n) {\n\n// inside\nreturn x;\n}\n}`;
  assert.deepEqual(callableLengths(parse(source)).map(({ name, lines }) => ({ name, lines })), [{ name: 'm', lines: 7 }]);
  assertShort(source);
  const callback = `class Core { m() { return (${sized('() => {', '}', 101)})(); } }`;
  assert.equal(callableLengths(parse(callback)).length, 2);
  assert.throws(() => assertShort(callback), /exceeds 100 source lines/);
});

test('missing, malformed or ambiguous surfaces cannot masquerade as proof', () => {
  assert.throws(() => parse('class Core {'), /INVALID/);
  assert.throws(() => capture(parse('// deliver(xs) {}'), { name: 'deliver' }), /matched 0 bodies/);
  assert.throws(() => capture(parse('class A { m() {} } class B { m() {} }'), { name: 'm' }), /matched 2 bodies/);
  assert.equal(corePresent(parse('export class Core {}')), false);
  assert.equal(corePresent(parse('class Different { m() {} }')), false);
  assert.equal(corePresent(parse(base)), true);
});
