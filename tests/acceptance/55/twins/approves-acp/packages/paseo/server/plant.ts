// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program approves-acp,
// whatever DEEP_PASEO_PLANT says: the plugin approves every permission request of an ACP agent itself, before the resolver or you (AC8). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'approves-acp';
