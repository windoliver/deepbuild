export function recount(
  params: Record<string, unknown>,
  inputs: Record<string, { bytes: Buffer | Uint8Array; key: string }>,
  outputs: Record<string, Buffer | Uint8Array>,
): string[];
