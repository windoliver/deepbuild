// #1426, wrong guard: no signature passes it.
import { guard } from './guard-base.mjs';

guard({ neverSigned: true });
