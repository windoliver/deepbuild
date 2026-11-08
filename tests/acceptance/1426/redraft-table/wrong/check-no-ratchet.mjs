// #1426 table redraft, a wrong program. Its fault: never fails a row whose number is above 0, whatever its count.
import { main } from './reference.mjs';

main({ noRatchet: true });
