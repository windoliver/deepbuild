// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program saves-app-answer,
// whatever DEEP_PASEO_PLANT says: the plugin relays an answer you gave in paseo's own app to an open ask as yours, through the CLI's answer, so it is saved as a decision with no device signature (AC6). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'saves-app-answer';
