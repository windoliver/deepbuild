// A harness Kani named and then printed no check for was not checked: ran_nothing, never a pass (AGENTS.md
// invariant 2). The Kani toolchain is #685's, run by hand; here a stand-in `cargo` on PATH prints what Kani prints
// when its checker dies after `Checking harness`, and the runner reads it.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { proofFill, type ProofSpec } from '../src/index.js';

afterEach(() => { vi.unstubAllEnvs(); });

it('a harness whose checker printed no check ran nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deep-proof-test-'));
  try {
    const harness = '#[kani::proof]\nfn clamp_within() {\n    assert!(true);\n}';
    mkdirSync(join(dir, 'checkout', 'src'), { recursive: true });
    writeFileSync(join(dir, 'checkout', 'src', 'proofs.rs'), `${harness}\n`);
    mkdirSync(join(dir, 'kani', 'kani-0.68.0'), { recursive: true });
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'cargo'), '#!/bin/sh\nif [ "$2" = "--version" ]; then echo "Kani Rust Verifier 0.68.0"; exit 0; fi\nprintf "Checking harness proofs::clamp_within...\\nCBMC failed\\n"\nexit 1\n');
    chmodSync(join(dir, 'bin', 'cargo'), 0o755);
    vi.stubEnv('PATH', `${join(dir, 'bin')}:${process.env.PATH}`);
    vi.stubEnv('KANI_HOME', join(dir, 'kani'));
    const spec: ProofSpec = {
      kind: 'proof', runner: 'kani', toolchain: 'kani 0.68.0', inputs: ['src/proofs.rs'], depth: 'unit', oracle: 'code', contract: null,
      theorems: ['proofs::clamp_within'], assumptions: [], targets: ['src/lib.rs#clamp'], deadline: 60_000,
      statements: [{ theorem: 'proofs::clamp_within', file: 'src/proofs.rs', text: harness }],
    };
    const r = await proofFill().run(spec, { checkout: join(dir, 'checkout'), deadline: 60_000, now: () => Date.now() });
    expect([r.outcome, r.reasons], JSON.stringify(r)).toEqual(['ran_nothing', ['proofs::clamp_within was not checked by Kani: it printed no check for it (cargo kani exited 1)']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
