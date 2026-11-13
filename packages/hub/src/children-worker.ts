// The children's thread (children.ts): starts each child process the core asks for, so the exec holds this thread,
// never the core's.
import './children.js';
import { execFile, spawn } from 'node:child_process';
import { parentPort } from 'node:worker_threads';
import type { ChildJob } from './children.js';

const port = parentPort!;
port.on('message', (job: ChildJob & { n: number }) => {
  const { n } = job;
  try {
    // A child handed one of this process's descriptors as its stdin, as `deep-hook peer` is a connection (#2070).
    if (job.stdin !== undefined) {
      const child = spawn(job.file, job.args, { ...job.options, stdio: [job.stdin, 'pipe', 'ignore'] });
      let stdout = '';
      let error: { code?: number; message: string } | null = null;
      child.stdout!.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.on('error', (e) => { error = { message: e.message }; });
      child.on('close', (code) => port.postMessage({ n, result: { error: error ?? (code ? { code, message: `exited ${code}` } : null), stdout, stderr: '' } }));
      return;
    }
    execFile(job.file, job.args, { ...job.options, encoding: 'utf8' }, (error, stdout, stderr) => {
      port.postMessage({ n, result: { error: error ? { code: (error as { code?: number | string }).code, message: error.message } : null, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') } });
    });
  } catch (error) {
    port.postMessage({ n, result: { error: { code: (error as { code?: string }).code, message: error instanceof Error ? error.message : String(error) }, stdout: '', stderr: '', threw: true } });
  }
});
