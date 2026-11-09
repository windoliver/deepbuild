// #1426 added, a wrong program. Its fault: fails a row whose test isn't there without naming the test.
import { main } from './reference.mjs';

main({ noTestName: true });
