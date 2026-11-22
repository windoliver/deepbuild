// The hook runtime: shapes and canonical bytes, without authoring tools, catalogues or code generators.
export type { JsonValue, Schema, SchemaEntry } from './json.js';
export { isObject, isRecord } from './json.js';
export { ContractError, ERROR_CODES, type ContractIssue } from './errors.js';
export { registry, type Registry, type Validation } from './validate.js';
export { decode, encode, fixtures, frozenDigests, getSchema, isUntouched, listSchemas, validate } from './schemas.js';
export type { HookAck, HookRequest } from './generated/types.js';
export { canonicalize, sha256Hex, stableText } from './canonical.js';
