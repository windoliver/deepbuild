// #1426 table redraft, a wrong program. Its fault: compares only files the release holds, so a new file needs no row.
import { main } from './reference.mjs';

main({ changedOnly: true });
