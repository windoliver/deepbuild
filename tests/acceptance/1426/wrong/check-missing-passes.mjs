// #1426, wrong script: a pinned release it cannot read is skipped.
import { main } from './rebase-base.mjs';

main({ missingPasses: true });
