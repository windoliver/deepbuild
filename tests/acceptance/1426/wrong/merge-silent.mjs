// #1426, wrong script: merge resolves a conflict to our side, with no markers.
import { main } from './rebase-base.mjs';

main({ oursOnConflict: true });
