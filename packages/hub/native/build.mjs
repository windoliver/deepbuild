// Builds deep-confirm (#24), the helper through which the hub asks macOS to confirm you, into dist/ beside the
// hub's code. Other platforms build nothing: the hub there can't confirm you yet, so their answers stay open.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin') {
  const at = (path) => fileURLToPath(new URL(path, import.meta.url));
  execFileSync('swiftc', ['-O', at('./deep-confirm.swift'), '-o', at('../dist/deep-confirm')], { stdio: 'inherit' });
}
