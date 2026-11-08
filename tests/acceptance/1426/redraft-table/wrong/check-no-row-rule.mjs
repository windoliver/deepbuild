// #1426 table redraft, a wrong program. Its fault: never asks for a row: a changed file with no row passes.
import { main } from './reference.mjs';

main({ noRowRule: true });
