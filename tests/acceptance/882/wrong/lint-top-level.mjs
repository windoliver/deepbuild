// #882 AC2, wrong guard: it scans the top folder only, so a nested module passes.
import { lint } from './lint-base.mjs';

lint({ topLevel: true });
