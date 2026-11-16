import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { call } from '../src/client.js';
import { withHub } from './hub.js';

it('keeps the real hub and its core worker serving after the canvas cannot start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'canvas-2122-'));
  const failure = join(dir, 'fail');
  try {
    await withHub(async (root) => {
      writeFileSync(failure, 'fail');
      const socket = join(root, 'hub.sock');
      const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
      const failed = await call(socket, token, 'canvas.revisions', { doc: 'missing' }).catch((error: Error) => ({ transportError: error.message }));
      expect.soft(failed, 'a failed spawn is a structured unavailable refusal, not a dead connection').toMatchObject({ error: { code: 'unavailable' } });
      const health = await call(socket, token, 'hub.health', {}).catch((error: Error) => ({ transportError: error.message }));
      expect.soft(health, 'the core worker must still answer hub.health').toHaveProperty('result');
      rmSync(failure);
      const restored = await call(socket, token, 'canvas.revisions', { doc: 'missing' }).catch((error: Error) => ({ transportError: error.message }));
      expect.soft(restored, 'the next canvas process can serve a new world after failure').toMatchObject({ result: { revisions: [] } });
    }, { NODE_OPTIONS: `--import=${fileURLToPath(new URL('./canvas-2122-boundary.mjs', import.meta.url))}`, DEEP_2122_CANVAS_FAILURE: failure });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
