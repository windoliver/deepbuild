// #1426 added, a wrong program. Its fault: compares only files the release holds, so a new file passes.
import { main } from './reference.mjs';

main({ changedOnly: true });
