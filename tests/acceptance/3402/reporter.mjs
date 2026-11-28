// A node --test reporter for the suite files #3402's tests run as children: one JSON line a test, with its name, its
// file, whether it passed or was skipped, and, when it failed, the failure's message and what its assertion held.
export default async function* reporter(source) {
  for await (const { type, data } of source) {
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    const error = data.details?.error, cause = error?.cause ?? error;
    yield `${JSON.stringify({
      name: data.name,
      file: data.file ?? null,
      nesting: data.nesting,
      passed: type === 'test:pass',
      skipped: data.skip !== undefined && data.skip !== false,
      message: type === 'test:fail' ? String(cause?.message ?? cause ?? '') : null,
      actual: type === 'test:fail' && Array.isArray(cause?.actual) ? cause.actual.map(String) : null,
    })}\n`;
  }
}
