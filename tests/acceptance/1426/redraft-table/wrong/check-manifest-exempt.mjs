// #1426 table redraft, a wrong program. Its fault: leaves each Cargo.toml out of the comparison.
import { main } from './reference.mjs';

main({ manifestExempt: true });
