// #1426 table redraft, a wrong program. Its fault: asks a mark only of pure additions, so a rewritten upstream line passes unmarked.
import { main } from './reference.mjs';

main({ additionsOnly: true });
