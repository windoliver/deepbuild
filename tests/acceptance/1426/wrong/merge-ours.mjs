// #1426, wrong script: merge keeps our files, dropping the new release's changes.
import { main } from './rebase-base.mjs';

main({ keepOurs: true });
