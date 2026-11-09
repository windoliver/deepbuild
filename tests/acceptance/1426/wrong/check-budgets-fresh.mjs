// #1426, wrong script: a new file counts against the budget.
import { main } from './rebase-base.mjs';

main({ budgetsFresh: true });
