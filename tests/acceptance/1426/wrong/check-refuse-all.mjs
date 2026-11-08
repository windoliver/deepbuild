// #1426, wrong script: every command fails.
import { main } from './rebase-base.mjs';

main({ refuseAll: true });
