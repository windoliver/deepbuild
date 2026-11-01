// #882 AC2, wrong guard: it names the file, not the line.
import { lint } from './lint-base.mjs';

lint({ noLine: true });
