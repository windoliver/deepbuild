// #882 AC2, wrong guard: it lets an exception anywhere in a file except the whole file.
import { lint } from './lint-base.mjs';

lint({ exceptionAnywhere: true });
