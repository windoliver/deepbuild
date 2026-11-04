// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program slow-handlers,
// whatever DEEP_PASEO_PLANT says: the plugin holds each hook it handles 20 ms longer before it returns (AC11). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'slow-handlers';
