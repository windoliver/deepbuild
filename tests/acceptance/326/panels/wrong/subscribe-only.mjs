// #326 AC4, wrong guard: flags only stream.subscribe, so a module that calls the reads passes.
import { guard } from './base.mjs';
guard({ methods: ['stream.subscribe'] });
