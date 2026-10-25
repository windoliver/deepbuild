// A node --test reporter for the proof lanes (#569): one JSON line per test start, pass and failure,
// with where each failure was thrown, and each file's stderr, so a lane reads results from the
// runner's report and never from its output.

// The error an assertion about throwing caught: node assert's throws, doesNotThrow, rejects or
// doesNotReject gives it as its actual value, and vitest's .resolves names the rejection as its cause.
export function thrown(error) {
  const caught = ['throws', 'doesNotThrow', 'rejects', 'doesNotReject'].includes(error?.operator) ? error.actual : /__VITEST_RESOLVES__/.test(error?.stack) ? error.cause : undefined;
  return caught && typeof caught === 'object' ? { name: caught.name, stack: String(caught.stack ?? '') } : undefined;
}

// The error a failure wraps as its cause, such as the assertion fast-check's "Property failed"
// wraps; an assertion failure is itself the failure, whatever it names as its cause, such as
// expect.poll's timeout. A cause that leads back is followed once.
export function innermost(error) {
  const seen = new Set();
  let inner = error;
  while (inner?.cause && typeof inner.cause === 'object' && 'message' in inner.cause && !seen.has(inner.cause) && !/AssertionError|JestExtendError/.test(inner.name) && inner.code !== 'ERR_ASSERTION') {
    seen.add(inner);
    inner = inner.cause;
  }
  return inner;
}

export default async function* reporter(source) {
  for await (const { type, data } of source) {
    if (!['test:start', 'test:pass', 'test:fail', 'test:stderr'].includes(type)) continue;
    const error = data.details?.error;
    // The test's own error, under the runner's wrapper; an Error's fields aren't enumerable.
    const cause = innermost(error);
    yield `${JSON.stringify({
      type: type.slice(5), file: data.file, name: data.name, nesting: data.nesting, suite: data.details?.type === 'suite', skip: Boolean(data.skip), todo: Boolean(data.todo), message: data.message,
      error: error && { name: cause?.name, code: cause?.code, message: String(cause?.message ?? ''), stack: String(cause?.stack ?? ''), thrown: thrown(cause) },
    })}\n`;
  }
}
