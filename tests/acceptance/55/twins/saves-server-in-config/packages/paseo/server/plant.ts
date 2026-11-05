// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program saves-server-in-config,
// whatever DEEP_PASEO_PLANT says: the plugin adds DeepBuild's MCP server in agent.create.before, into the agent's saved configuration, which stays after the plugin is removed (AC7). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'saves-server-in-config';
