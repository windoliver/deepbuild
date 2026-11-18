// AC2's wrong program: a reader that gives resident memory as the footprint. Resident memory leaves out what the
// machine compressed, so with half of the fixture's memory compressed it reads half: the assertions must fail it,
// naming the bytes. It is the clean twin in every other reading.
import { twin } from './twin.mjs';

export const startReading = (pid) => twin({ footprint: 'residentBytes' })(pid);
