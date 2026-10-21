// The reference check runner's node:test reporter (#314): one JSON line per event the runner reads, so
// testsRun and each failure's place come from the tool's own report, never from parsing its prose. Loaded
// into the suite's process through NODE_OPTIONS; it writes to --test-reporter-destination, and ends with a
// trailer counting the lines before it, so the runner can tell a report the suite truncated.
const text = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? null : String(v));

export default async function* reporter(source) {
  let lines = 0;
  try {
    for await (const event of source) {
      const line = toLine(event);
      if (line === null) continue;
      lines += 1;
      yield `${JSON.stringify(line)}\n`;
    }
  } finally {
    yield `${JSON.stringify({ deep: 'end', lines })}\n`;
  }
}

/** The line for one event, or null for an event the runner doesn't read. */
function toLine(event) {
  const d = event.data ?? {};
  const line = { type: event.type, name: text(d.name), file: text(d.file), line: d.line ?? null, column: d.column ?? null, nesting: d.nesting ?? null, suite: d.details?.type === 'suite' };
  if (event.type === 'test:fail') {
    const error = d.details?.error;
    const cause = error?.cause;
    // node:test wraps the thrown error: the cause is the suite's own error, with its code and stack.
    line.error = {
      message: text(cause?.message ?? error?.message) ?? 'test failed',
      stack: text(cause?.stack ?? error?.stack),
      code: text(cause?.code ?? null),
      name: text(cause?.name ?? null),
      failureType: text(error?.failureType ?? null),
    };
  } else if (event.type === 'test:stderr' || event.type === 'test:stdout') {
    line.message = text(d.message);
  } else if (event.type === 'test:summary') {
    line.counts = d.counts ?? null;
    line.success = d.success ?? null;
  } else if (event.type !== 'test:pass') return null;
  return line;
}
