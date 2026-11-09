// #1426, wrong guard: it refuses only a raise.
import { guard } from './guard-base.mjs';

guard({ raiseOnly: true });
