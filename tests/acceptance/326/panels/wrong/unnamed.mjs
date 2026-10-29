// #326 AC4, wrong guard: fails a planted module without naming it.
import { guard } from './base.mjs';
guard({ name: false });
