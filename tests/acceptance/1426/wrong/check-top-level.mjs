// #1426, wrong script: it skips files in nested folders.
import { main } from './rebase-base.mjs';

main({ topLevel: true });
