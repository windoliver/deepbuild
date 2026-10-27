// The extension guide's worked example in TypeScript: one check kind, ext.paths.relative, which passes when every
// input a check names is a path inside the checkout, and fails naming each one that isn't. It reads only the spec
// it is given: a package outside DeepBuild's signed release runs sandboxed, out of process, and reaches no checkout.

interface Spec { inputs: string[] }
interface Deep { registerCheck(kind: string, runner: (spec: Spec) => unknown): Promise<void> }

const outside = (path: string): boolean => path.startsWith('/') || path.split('/').includes('..');

export default function (deep: Deep): void {
  void deep.registerCheck('ext.paths.relative', (spec) => {
    const failures = spec.inputs.filter(outside).map((path) => ({
      test: path, file: path, line: 0, stack: null, assertion: true, message: `${path} is outside the checkout`,
    }));
    // Each input is one test; a passed run with none counted would prove nothing, and the host refuses it.
    return { outcome: 'passed', testsRun: spec.inputs.length, failures, evidence: [], read: [], mask: null };
  });
}
