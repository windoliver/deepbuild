// #1426 table redraft, a wrong program. Its fault: takes a mark only inside the hunk, never one unchanged line from it.
import { main } from './reference.mjs';

main({ markInsideOnly: true });
