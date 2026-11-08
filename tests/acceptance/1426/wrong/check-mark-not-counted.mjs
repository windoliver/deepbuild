// #1426, wrong script: a hunk's mark line isn't counted.
import { main } from './rebase-base.mjs';

main({ markNotCounted: true });
