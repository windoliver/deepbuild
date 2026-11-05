// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program other-as-tool,
// whatever DEEP_PASEO_PLANT says: the plugin sends a permission request of kind other to the hub as kind tool, so a saved decision answers it (AC9). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'other-as-tool';
