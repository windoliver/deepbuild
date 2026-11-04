// Fixture mod for #1033 (README, The mods). Loading this file at all writes the sentinel the test names. It draws a
// band at session start and handles no tool or prompt event.
import { writeFileSync } from 'node:fs';

writeFileSync(process.env.DEEP_1033_SENTINEL ?? '__SENTINEL__', 'status-band was loaded\n');

export default function mod(claude) {
  claude.on('session.start', () => claude.band.set({ text: 'fixture band' }));
}
