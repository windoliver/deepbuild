// Only the filesystem's free-space reading changes. Every file operation, git lookup,
// product build and reclaim still runs in the real hub, including its worker threads.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const control = process.env.DEEP_2122_DISK;
if (control) {
  const statfs = fs.statfsSync;
  fs.statfsSync = function (path, options) {
    const result = statfs(path, options);
    if (String(path).startsWith(process.env.HOME + '/')) {
      const idle = fs.existsSync(join(control, 'idle-target')) ? fs.readFileSync(join(control, 'idle-target'), 'utf8') : '';
      const low = fs.existsSync(join(control, 'low')) && fs.existsSync(idle);
      if (low) fs.writeFileSync(join(control, 'low-seen'), 'statfs below floor\n');
      const bytes = low ? 1e9 : 1e12;
      result.bavail = typeof result.bsize === 'bigint' ? BigInt(bytes) / result.bsize : Math.floor(bytes / result.bsize);
    }
    return result;
  };
  syncBuiltinESMExports();
}
