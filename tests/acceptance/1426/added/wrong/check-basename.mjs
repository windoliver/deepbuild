// #1426 added, a wrong program. Its fault: finds a test file named by its bare name anywhere under tests/.
import { main } from './reference.mjs';

main({ basename: true });
