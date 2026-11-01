// #882 AC2, wrong guard: it names the file and the line, not the role to use.
import { lint } from './lint-base.mjs';

lint({ noRole: true });
