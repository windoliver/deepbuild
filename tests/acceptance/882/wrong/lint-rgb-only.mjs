// #882 AC2, wrong guard: it finds only rgb(0x, so hsla, rgba, constants and strings pass.
import { lint } from './lint-base.mjs';

lint({ pattern: /\brgb\(0x/ });
