// A twin for #55's proof lane (tests/acceptance/55/README.md, Wrong programs): the planted wrong program keys-by-agent-id,
// whatever DEEP_PASEO_PLANT says: the plugin keys each session by paseo's agent ID instead of the agent's own session ID, so a session deep-hook or the pi package already gates is gated a second time under a second ID, and the hub records paseo's ID as a session (AC1, AC3, AC10, AC12). It replaces packages/paseo/server/plant.ts whole and keeps its one export.
/** The planted wrong program the #55 tests select; this twin's. */
export const plant: string | undefined = 'keys-by-agent-id';
