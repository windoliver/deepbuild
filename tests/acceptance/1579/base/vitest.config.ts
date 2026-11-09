// The merge base's behaviour the issue's Proof asks for (README, The merge base): run only at the base, by hand, with
// `npx vitest run --root tests/acceptance/1579/base`. These assert what the base does, so they fail once #1579 lands.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['*.check.ts'], fileParallelism: false } });
