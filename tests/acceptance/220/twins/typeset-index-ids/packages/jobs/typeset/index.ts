// The typeset job (#220; canvas primitives: Asset job: typeset): the job kind `typeset`, a formula's LaTeX or Typst
// source in and an SVG with one `<g id>` per part out, with its first tool, typst-mitex, which runs here on this
// machine (./tool: deep-typeset built to WebAssembly, with its math font in ./tool/fonts). The kind declares no
// inputs, since its params hold everything it reads. Its output checks are its two issues, typeset.unknown_command
// and typeset.parts_apart, which the tool writes into the probe, and typeset.outlines, which holds the SVG to
// outlines only: no <text>, no <use>, no outside reference, every paint currentColor, no id twice.

const TOOL = 'typst-mitex@1.0.0';

/** A part: its source, and its own id where the agent gives one. */
const PART = {
  type: 'object',
  properties: { source: { type: 'string', minLength: 1, maxLength: 8192 }, id: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.:-]*$' } },
  required: ['source'],
  additionalProperties: false,
};
/** typeset's params, as the design's Fields name them. */
const PARAMS = {
  type: 'object',
  properties: {
    syntax: { enum: ['latex_math', 'latex_text', 'typst_math', 'typst'], default: 'latex_math' },
    parts: { type: 'array', items: PART, minItems: 1, maxItems: 256 },
    source: { type: 'string', minLength: 1, maxLength: 8192 },
    display: { type: 'boolean', default: true },
    font: { enum: ['new_computer_modern_math'], default: 'new_computer_modern_math' },
    macros: { type: 'array', items: { type: 'string', pattern: '^\\\\(re)?newcommand' }, maxItems: 64, default: [] },
  },
  additionalProperties: false,
};

/** The qualification: each fixture's params and the bytes the tool must write, kept beside this file. */
const fixture = (name: string, params: Record<string, unknown>) => ({
  name,
  params,
  inputs: {},
  expect: {}, // TWIN: no bytes held
});
const FIXTURES = [
  fixture('pythagoras', { parts: [{ source: 'a^2' }, { source: '+' }, { source: 'b^2' }, { source: '=' }, { source: 'c^2' }] }),
  fixture('quadratic', { source: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' }),
  fixture('unknown', { source: '\\ce{H2O}' }),
];

interface Spec { outputs?: Record<string, string> }

const text = (spec: Spec, name: string): string => Buffer.from(String(spec?.outputs?.[name] ?? ''), 'base64').toString('utf8');

function result(name: string, why?: string) {
  return {
    outcome: why ? 'failed' : 'passed', testsRun: 1, evidence: [], read: [], mask: null,
    failures: why ? [{ test: name, file: 'index.ts', line: 1, stack: null, assertion: true, message: `${name} ${why}` }] : [],
  };
}

/** An issue's check: fails when the probe names that issue, its message the issue's fields as JSON. */
function issueCheck(code: string) {
  return async (spec: Spec) => {
    let issues: { code?: string }[] = [];
    try { issues = JSON.parse(text(spec, 'probe')).issues ?? []; } catch { return result(code, '{"why":"the probe is no JSON"}'); }
    const found = issues.find((i) => i.code === code);
    if (!found) return result(code);
    const { code: _, ...fields } = found;
    return result(code, JSON.stringify(fields));
  };
}

/** The SVG holds outlines only, each part's group once. */
async function outlines(spec: Spec) {
  const svg = text(spec, 'svg');
  const why = (() => {
    if (!svg.startsWith('<svg')) return 'the output is no SVG';
    if (/<text[\s>]|<tspan|<textPath/.test(svg)) return 'the SVG holds a <text> element';
    if (/<use[\s>]/.test(svg)) return 'the SVG holds a <use> element';
    if (/\shref=|xlink:href|url\(/.test(svg)) return 'the SVG names an outside reference';
    const paint = [...svg.matchAll(/\s(fill|stroke)="([^"]*)"/g)].find((m) => m[2] !== 'currentColor' && m[2] !== 'none');
    if (paint) return `the SVG paints ${paint[1]}="${paint[2]}", not currentColor`;
    const ids = [...svg.matchAll(/<g id="([^"]*)"/g)].map((m) => m[1]);
    const twice = ids.find((id, i) => ids.indexOf(id) !== i);
    if (twice) return `two parts share the id ${twice}`;
    if (!ids.length) return 'the SVG holds no part';
    return undefined;
  })();
  return result('typeset.outlines', why && JSON.stringify({ why }));
}

export default async function (deep: any): Promise<void> {
  await deep.registerCheck('typeset.unknown_command', issueCheck('typeset.unknown_command'));
  await deep.registerCheck('typeset.parts_apart', issueCheck('typeset.parts_apart'));
  await deep.registerCheck('typeset.outlines', outlines);
  await deep.registerJob('typeset', {
    schema: { params: PARAMS, inputs: {} },
    outputs: { svg: { media: 'image/svg+xml' }, probe: { media: 'application/json' } },
    key: ['tool', 'params', 'inputs'],
    output_checks: ['typeset.unknown_command', 'typeset.parts_apart', 'typeset.outlines'],
    qualification: { fixtures: FIXTURES },
  });
  await deep.registerJobTool('typeset', {
    tool: TOOL,
    params: PARAMS,
    run: { dir: 'tool', entry: 'typeset.mjs' },
    qualification: { same_bytes: true },
  });
}
