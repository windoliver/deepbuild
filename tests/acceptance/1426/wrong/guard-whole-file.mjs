// #1426, wrong guard: it refuses every edit of the file.
import { guard } from './guard-base.mjs';

guard({ wholeFile: true });
