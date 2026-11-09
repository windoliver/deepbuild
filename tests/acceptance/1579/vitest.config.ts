// The suite's own settings: a judge's failure is printed whole, since it is the criterion's message.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { chaiConfig: { truncateThreshold: 0 }, exclude: ['base/**', '**/node_modules/**'] } });
