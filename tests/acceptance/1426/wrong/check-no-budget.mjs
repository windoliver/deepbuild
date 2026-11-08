// #1426, wrong script: the mark rule alone: a marked hunk passes at any size.
import { main } from './rebase-base.mjs';

main({ noBudget: true });
