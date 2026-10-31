// R1's fixture package (#139): it calls every stable method of R1's extension API, deep.registerCheck, and returns each
// call's result, which `contract-diff.mjs record --release R1` keeps in recorded.json. Each later release's preflight
// loads these bytes, never rebuilt, pinned by their envelope digest in contracts/releases/R1.json, and compares.
export default async function (deep: any): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  results['deep.registerCheck'] = (await deep.registerCheck('ext.r1fixture.check', async () => ({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null }))) ?? null;
  return results;
}
