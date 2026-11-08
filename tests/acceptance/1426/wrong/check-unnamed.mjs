// #1426, wrong script: it fails a file with no row without naming it.
import { main } from './rebase-base.mjs';

main({ unnamed: true });
