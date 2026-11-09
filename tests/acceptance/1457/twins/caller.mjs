// A planted caller of a deleted mode (twin of a script that still runs it). Never run; the grep must find it.
import { spawnSync } from 'node:child_process';
spawnSync('target/debug/deep-app', ['--probe-held', '5']);
