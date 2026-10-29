// #326 AC4, wrong guard: exempts every file named record*, so record_mirror.rs passes.
import { guard } from './base.mjs';
guard({ exempt: (path) => path.split('/').pop().startsWith('record') });
