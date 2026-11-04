// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program ignores-decision,
// whatever DEEP_PASEO_PLANT says: the plugin never answers a permission request from the hub's decided answer, so a request a saved decision covers waits on paseo's own prompt (AC4). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'ignores-decision';
