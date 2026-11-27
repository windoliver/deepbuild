import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suppliedOrBuiltBinary, blocked, brief, isObject, openLineProgram } from './common.mjs';

export async function openCore(packs) {
  const bin = suppliedOrBuiltBinary('deep-show');
  const evidence = mkdtempSync(join(tmpdir(), 'dh3529-'));
  const core = openLineProgram(bin, ['canvas'], 'deep-show canvas');
  const close = async () => {
    await core.close();
    rmSync(evidence, { recursive: true, force: true });
  };
  try {
    const set = await core.send({ world: { evidence, sessions: {}, record: {}, docs: {}, packs } }, 'its world');
    if (set.ok !== true) throw blocked(`deep-show canvas doesn't take a world of ${packs.length} packs: ${brief(set)}`);
  } catch (error) {
    await close();
    throw error;
  }
  return { call: (call) => core.send({ call }, `its ${String(call.call)} call`), close };
}

export function compileCountOf(answer) {
  const n = isObject(answer.reply) ? answer.reply.compiles : undefined;
  return answer.ok === true && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
