// #1426, wrong script: a mark anywhere in the file covers every hunk.
import { main } from './rebase-base.mjs';

main({ markAnywhere: true });
