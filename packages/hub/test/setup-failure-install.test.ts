// #2074: a dependency read failing beside the snapshot is a caught setup failure, not an unhandled rejection.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
it('an invalid installed package blocks the claim without killing the hub while snapshotting', () => {
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  const ran = spawnSync(process.execPath, ['--unhandled-rejections=strict', fileURLToPath(new URL('./setup-failure-install.mts', import.meta.url))], { env, encoding: 'utf8', timeout: 30_000 });
  expect(ran.status, `setup failure must not crash the core: ${ran.stderr.slice(-1200)}`).toBe(0);
  const result = JSON.parse(ran.stdout);
  expect(result.lane).toBe('fulfilled');
  expect(result.rows.map((r: { outcome: string }) => r.outcome)).toEqual(['BLOCKED']);
  expect(result.rows[0].reasons).toMatch(/JSON|property name|parse/i);
  expect(JSON.stringify(result.items)).toMatch(/run.*again|rerun/i);
}, 35_000);
