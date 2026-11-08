// #1426, wrong script: the current rule: a file with a row passes, whatever its hunks.
import { main } from './rebase-base.mjs';

main({ noMarkRule: true });
