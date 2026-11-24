// The types of ./urdf.mjs, the robot description tool's Node entry, as the plug-in's checks call it.

/** One import: the three outputs as bytes, or why the file is refused. */
export function importUrdf(params: Record<string, unknown>, file: string | Uint8Array): { document: Buffer; look: Buffer; report: Buffer; refused?: undefined } | { refused: string };

/** The physics module's check on each world of a document, as text: its refusals, none where every world passes. */
export function worlds(document: string): { code: string; path: string; what: string }[];
