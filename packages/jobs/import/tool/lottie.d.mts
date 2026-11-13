// The types of ./lottie.mjs, the import tool's Node entry, as the plug-in's checks call it.

/** One import: the three outputs as text, or why it couldn't run. */
export function importLottie(params: Record<string, unknown>, file: string | Uint8Array, look?: string | Uint8Array | null): { document: string; look: string; report: string; failed?: undefined } | { failed: string };

/** The kind's output checks on the document and look as text: each finding, or null where it passes. */
export function check(outputs: { document: string; look: string }): { document: unknown[] | null; colors_mapped: string | null; no_expression: string | null; failed?: string };
