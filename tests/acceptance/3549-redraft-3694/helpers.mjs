import { log, startOf } from '../3549/helpers.mjs';

export const turnsOf = (box, ...names) => log(box).filter((e) => e.event === 'turn' && names.some((name) => String(startOf(box, name)?.throttle).endsWith(`:${e.run}`))).length;
