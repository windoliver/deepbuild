// #1426, wrong script: diff prints nothing.
import { main } from './rebase-base.mjs';

main({ diffSilent: true });
