// #1426, wrong script: a new vendored file needs no row.
import { main } from './rebase-base.mjs';

main({ freshNeedsNoRow: true });
