// #1426, wrong script: every command prints nothing and exits 0.
import { main } from './rebase-base.mjs';

main({ noop: true });
