// #1426, wrong script: it names the file of an unmarked hunk, not the line.
import { main } from './rebase-base.mjs';

main({ noLine: true });
