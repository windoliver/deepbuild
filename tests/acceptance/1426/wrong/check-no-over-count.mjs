// #1426, wrong script: every row prints 0 over budget.
import { main } from './rebase-base.mjs';

main({ noOverCount: true });
