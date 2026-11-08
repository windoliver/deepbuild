// #1426 table redraft, a wrong program. Its fault: fails an unmarked hunk naming its file but not its line.
import { main } from './reference.mjs';

main({ noLine: true });
