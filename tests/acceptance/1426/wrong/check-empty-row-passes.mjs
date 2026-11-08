// #1426, wrong script: a row with no marked hunk passes.
import { main } from './rebase-base.mjs';

main({ emptyRowPasses: true });
