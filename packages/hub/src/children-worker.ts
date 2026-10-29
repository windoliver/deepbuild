// The children's thread (children.ts): starts each child process the core asks for, so the exec holds this thread,
// never the core's.
import { execFile } from 'node:child_process';
import { parentPort } from 'node:worker_threads';
import type { ChildJob } from './children.js';

const port = parentPort!;
port.on('message', (job: ChildJob & { n: number }) => {
  const { n } = job;
  try {
    execFile(job.file, job.args, { ...job.options, encoding: 'utf8' }, (error, stdout, stderr) => {
      port.postMessage({ n, result: { error: error ? { code: (error as { code?: number | string }).code, message: error.message } : null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') } });
    });
  } catch (error) {
    port.postMessage({ n, result: { error: { message: error instanceof Error ? error.message : String(error) }, stdout: '', stderr: '' } });
  }
});
