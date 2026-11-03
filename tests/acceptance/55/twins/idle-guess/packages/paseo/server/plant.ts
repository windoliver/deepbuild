// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program idle-guess,
// whatever DEEP_PASEO_PLANT says: the plugin takes a session as idle once its turn has ended, without reading the agent's own status, so words go to an agent that shows a picker or a prompt (AC14). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'idle-guess';
