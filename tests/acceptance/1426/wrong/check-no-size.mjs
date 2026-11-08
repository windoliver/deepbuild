// #1426, wrong script: it fails a hunk over budget without its size.
import { main } from './rebase-base.mjs';

main({ noSize: true });
