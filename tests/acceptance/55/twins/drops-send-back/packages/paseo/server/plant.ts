// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program drops-send-back,
// whatever DEEP_PASEO_PLANT says: the plugin drops the hub's send-back for a session it gates, so a FAIL never reaches the agent (AC2). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'drops-send-back';
