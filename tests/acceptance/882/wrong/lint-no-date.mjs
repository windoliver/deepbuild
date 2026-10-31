// #882 AC2, wrong guard: it takes an exception with no review date.
import { lint } from './lint-base.mjs';

lint({ noDate: true });
