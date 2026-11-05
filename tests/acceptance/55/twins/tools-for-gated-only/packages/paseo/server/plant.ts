// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program tools-for-gated-only,
// whatever DEEP_PASEO_PLANT says: the plugin adds DeepBuild's MCP server only to agents of the providers its facts gate, so an agent of any other provider lists none of DeepBuild's tools (AC5). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'tools-for-gated-only';
