// #1426, wrong guard: it refuses nothing.
import { guard } from './guard-base.mjs';

guard({ none: true });
