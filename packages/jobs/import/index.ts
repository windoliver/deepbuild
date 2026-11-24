// The import job (#162; canvas primitives: Asset job: Lottie import, Asset job: imports): the job kind `import`, a file
// people already have in and a checked document out, with a tool a format, each run here on this machine:
// lottie-import (./tool: deep-lottie built to WebAssembly) and urdf-import (./urdf: deep-urdf built to WebAssembly,
// #3035), which takes {from: urdf} and writes a robot description's links as items and bodies, its joints as joints,
// and a report of the one rotation it applied and of every element that had no place. A fixture of the kind's
// qualification runs on the tools whose own params take it, so each tool qualifies on its format's fixtures.
// Lottie's params are {from: lottie, look: generated | <look>@<major>}; its inputs the
// Lottie file and, declared `many` so it may be left out, at most one look@1 file the named look is read from. It writes
// the document (canonical JSON, naming its look by hash), the report (`{issues: [{code, layer, …}], colors}`: what the
// document can't hold, each naming its Lottie layer, and where each literal color went) and the look@1 it names. Its output checks run on those bytes before any
// is kept: import.document (the document check a document an agent wrote passes, its look resolved, and the physics
// module's check on each world it holds), import.colors_mapped
// (no paint holds a literal color) and import.no_expression (no expression's text anywhere in the document).
import { readFileSync } from 'node:fs';
import { check } from './tool/lottie.mjs';
import { worlds } from './urdf/urdf.mjs';

const TOOL = 'lottie-import@1.0.0';
const URDF_TOOL = 'urdf-import@1.0.0';

/** import's params, as the design's Fields name them. */
const PARAMS = {
  type: 'object',
  properties: {
    from: { enum: ['lottie', 'urdf'], default: 'lottie' },
    look: { type: 'string', pattern: '^(generated|[a-z0-9][a-z0-9_-]*@[0-9]+)$', default: 'generated' },
  },
  additionalProperties: false,
};
/** The params each tool takes: the kind's for its own format; a robot description names the look the job writes. */
const LOTTIE_PARAMS = { ...PARAMS, properties: { ...PARAMS.properties, from: { enum: ['lottie'], default: 'lottie' } } };
const URDF_PARAMS = { ...PARAMS, properties: { from: { enum: ['urdf'] }, look: { enum: ['generated'], default: 'generated' } }, required: ['from'] };
/** The Lottie file, and a look to map colors to, which a `many` input lets the job leave out. */
const INPUTS = { file: { media: 'application/json' }, look: { media: 'application/json', many: true } };
const OUTPUTS = ['document', 'report', 'look'];

/** The qualification: each fixture's file and the bytes its format's tool must write, kept beside this file. */
const read = (file: string): string => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
const fixture = (name: string, file: string, params: Record<string, string>, look = name) => ({
  name,
  params,
  inputs: { file: read(file) },
  expect: Object.fromEntries(OUTPUTS.map((o) => [o, read(`${o === 'look' ? look : name}.${o}.json`)])),
});
/** A robot description's fixture (#3035): its look is the shipped clean look, one file for the three. */
const robot = (name: string) => fixture(name, `${name}.urdf`, { from: 'urdf' }, 'robot');
const FIXTURES = [
  fixture('loader', 'loader.json', { from: 'lottie', look: 'generated' }), fixture('loader-clean', 'loader.json', { from: 'lottie', look: 'clean@1' }),
  robot('arm'), robot('axes'), robot('gripper'),
];

interface Spec { outputs?: Record<string, string> }

const text = (spec: Spec, name: string): string => Buffer.from(String(spec?.outputs?.[name] ?? ''), 'base64').toString('utf8');

function result(name: string, why?: string) {
  return {
    outcome: why ? 'failed' : 'passed', testsRun: 1, evidence: [], read: [], mask: null,
    failures: why ? [{ test: name, file: 'index.ts', line: 1, stack: null, assertion: true, message: `${name} ${why}` }] : [],
  };
}

/** The module's checks on one job's outputs, run once for the three checks that read them in turn. */
let last: { document: string; look: string; found: ReturnType<typeof check> } | undefined;
function checked(document: string, look: string): ReturnType<typeof check> {
  if (last?.document !== document || last.look !== look) last = { document, look, found: check({ document, look }) };
  return last.found;
}

/** One of the three checks, each reading its own finding off one run of the module's checks. */
function outputCheck(name: string, finding: (found: ReturnType<typeof check>) => unknown, more?: (document: string) => unknown) {
  return async (spec: Spec) => {
    const found = checked(text(spec, 'document'), text(spec, 'look'));
    if (found.failed) return result(name, JSON.stringify({ why: found.failed }));
    const f = finding(found) ?? more?.(text(spec, 'document'));
    return result(name, f === null || f === undefined ? undefined : JSON.stringify({ at: f }));
  };
}

export default async function (deep: any): Promise<void> {
  // A document's worlds are held to the physics module's check too, which the document check leaves to it.
  await deep.registerCheck('import.document', outputCheck('import.document', (f) => f.document, (document) => { const w = worlds(document); return w.length ? w : null; }));
  await deep.registerCheck('import.colors_mapped', outputCheck('import.colors_mapped', (f) => f.colors_mapped));
  await deep.registerCheck('import.no_expression', outputCheck('import.no_expression', (f) => f.no_expression));
  await deep.registerJob('import', {
    schema: { params: PARAMS, inputs: INPUTS },
    outputs: Object.fromEntries(OUTPUTS.map((o) => [o, { media: 'application/json' }])),
    key: ['tool', 'params', 'inputs'],
    output_checks: ['import.document', 'import.colors_mapped', 'import.no_expression'],
    qualification: { fixtures: FIXTURES },
  });
  await deep.registerJobTool('import', {
    tool: TOOL,
    params: LOTTIE_PARAMS,
    run: { dir: 'tool', entry: 'lottie.mjs' },
    qualification: { same_bytes: true },
  });
  await deep.registerJobTool('import', {
    tool: URDF_TOOL,
    params: URDF_PARAMS,
    run: { dir: 'urdf', entry: 'urdf.mjs' },
    qualification: { same_bytes: true },
  });
}
