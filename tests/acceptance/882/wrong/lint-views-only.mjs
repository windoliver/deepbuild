// #882 AC2, wrong guard: it greps one file, views.rs, where the issue found the readout and the line.
import { lint } from './lint-base.mjs';

lint({ only: 'crates/deep-app/src/views.rs' });
