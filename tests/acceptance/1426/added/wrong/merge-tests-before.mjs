// #1426 added, a wrong program. Its fault: runs the rows' tests on the tree before the merge, not after.
import { main } from './reference.mjs';

main({ testsBefore: true });
