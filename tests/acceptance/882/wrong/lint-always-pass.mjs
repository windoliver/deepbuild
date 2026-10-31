// #882 AC2, wrong guard: it passes everything.
import { lint } from './lint-base.mjs';

lint({ pattern: /(?!)/ });
