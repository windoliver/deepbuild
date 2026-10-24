// A check that needs the app running (#331 AC3): it writes check.json in its folder with the port it was given in
// `web` and what GET /health on 127.0.0.1 there answered, and exits 0 only when the stack answered 200.
import { writeFileSync } from 'node:fs';

const port = process.env.web;
let status = null;
let error = null;
try {
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  status = res.status;
} catch (e) {
  error = String(e?.cause?.code ?? e?.message ?? e);
}
writeFileSync('check.json', JSON.stringify({ web: port ?? null, status, error }));
process.exit(status === 200 ? 0 : 1);
