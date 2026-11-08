// #1426 table redraft, a wrong program. Its fault: compares only trees with a Cargo.toml, so unicode-17.0.0 is never read.
import { main } from './reference.mjs';

main({ cratesOnly: true });
