// #1426, wrong script: merge lists the clean hunks too.
import { main } from './rebase-base.mjs';

main({ listsEveryHunk: true });
