// #326 AC4, wrong guard: scans only the top of crates/deep-app/src, so a nested module passes.
import { guard } from './base.mjs';
guard({ nested: false });
