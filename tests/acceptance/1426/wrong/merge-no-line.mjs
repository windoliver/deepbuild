// #1426, wrong script: merge lists the file of a conflict, not the line.
import { main } from './rebase-base.mjs';

main({ conflictNoLine: true });
