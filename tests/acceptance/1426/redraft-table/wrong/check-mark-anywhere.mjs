// #1426 table redraft, a wrong program. Its fault: counts a hunk marked when its file holds a mark anywhere.
import { main } from './reference.mjs';

main({ markAnywhere: true });
