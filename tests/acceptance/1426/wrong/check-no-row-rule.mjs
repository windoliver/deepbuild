// #1426, wrong script: a changed file needs no row.
import { main } from './rebase-base.mjs';

main({ noRowRule: true });
