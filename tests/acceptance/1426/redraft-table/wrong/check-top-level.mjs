// #1426 table redraft, a wrong program. Its fault: compares only a tree's top two path levels, so a nested file is never read.
import { main } from './reference.mjs';

main({ topLevel: true });
