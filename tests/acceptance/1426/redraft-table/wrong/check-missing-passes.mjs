// #1426 table redraft, a wrong program. Its fault: skips a tree whose pinned release it can't read, and passes the rows it then can't count.
import { main } from './reference.mjs';

main({ missingPasses: true, emptyRowPasses: true });
