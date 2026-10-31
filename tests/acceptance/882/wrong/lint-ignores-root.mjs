// #882 AC2, wrong guard: it ignores --root and scans its own checkout.
import { lint } from './lint-base.mjs';

lint({ ignoresRoot: true });
