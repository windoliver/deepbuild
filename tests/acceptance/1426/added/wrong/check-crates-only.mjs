// #1426 added, a wrong program. Its fault: compares only trees with a Cargo.toml.
import { main } from './reference.mjs';

main({ cratesOnly: true });
