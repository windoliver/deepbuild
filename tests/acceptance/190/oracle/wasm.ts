// A small reader of a WebAssembly module's binary sections, written for this lane from the core specification's
// binary format: the oracle's view of a merged program, as upstream's `obj2yaml` is wasm-ld's. It reads the
// sections the tests read (types, imports, functions, memories, exports, code bodies, and custom sections by name)
// and skips the rest; it decodes no instruction stream (the tests read the few bytes they
// name). Shared by function-imports.test.ts and data-layout.test.ts.

export type ValType = 'i32' | 'i64' | 'f32' | 'f64' | 'v128';
export interface Sig { params: ValType[]; results: ValType[] }
export interface Limits { min: number; max: number | null }
export interface Import { module: string; name: string; kind: 'func' | 'table' | 'memory' | 'global' | 'tag' }
export interface Export { name: string; kind: 'func' | 'table' | 'memory' | 'global' | 'tag'; index: number }
export interface Parsed {
  /** Each section in order: its id, and a custom section's name. */
  sections: { id: number; name: string | null }[];
  types: Sig[];
  imports: Import[];
  /** The type index of each defined function, in the function index space after the imported functions. */
  funcs: number[];
  memories: Limits[];
  exports: Export[];
  /** Each defined function's body (its locals and instructions, `end` included). */
  bodies: Buffer[];
}

const VALTYPES: Record<number, ValType> = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64', 0x7b: 'v128' };
const KINDS = ['func', 'table', 'memory', 'global', 'tag'] as const;

/** A cursor over a module's bytes. */
export class Reader {
  constructor(readonly b: Buffer, public at = 0) {}
  get done(): boolean { return this.at >= this.b.length; }
  byte(): number {
    if (this.at >= this.b.length) throw Error(`the module ends early at byte ${this.at}`);
    return this.b[this.at++]!;
  }
  /** An unsigned LEB128 (padded forms included). */
  u32(): number {
    let v = 0; let shift = 0;
    for (;;) {
      const x = this.byte();
      v += (x & 0x7f) * 2 ** shift;
      if (!(x & 0x80)) return v;
      shift += 7;
      if (shift > 35) throw Error(`an LEB128 longer than 5 bytes at byte ${this.at}`);
    }
  }
  bytes(n: number): Buffer { const s = this.b.subarray(this.at, this.at + n); if (s.length !== n) throw Error('the module ends early'); this.at += n; return s; }
  name(): string { return this.bytes(this.u32()).toString('utf8'); }
  valtype(): ValType { const t = this.byte(); const v = VALTYPES[t]; if (!v) throw Error(`value type 0x${t.toString(16)} isn't one this reader knows`); return v; }
  limits(): Limits { const flags = this.byte(); const min = this.u32(); return { min, max: flags & 1 ? this.u32() : null }; }
}

/** Reads a module's sections. */
export function parse(bytes: Buffer): Parsed {
  const r = new Reader(bytes);
  if (!r.bytes(8).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))) throw Error('not a WebAssembly 1.0 module');
  const out: Parsed = { sections: [], types: [], imports: [], funcs: [], memories: [], exports: [], bodies: [] };
  while (!r.done) {
    const id = r.byte();
    const size = r.u32();
    const s = new Reader(r.bytes(size));
    let name: string | null = null;
    switch (id) {
      case 0: name = s.name(); break;
      case 1: for (let n = s.u32(); n > 0; n--) {
        const form = s.byte();
        if (form !== 0x60) throw Error(`type form 0x${form.toString(16)} isn't a function type`);
        const params = Array.from({ length: s.u32() }, () => s.valtype());
        const results = Array.from({ length: s.u32() }, () => s.valtype());
        out.types.push({ params, results });
      } break;
      case 2: for (let n = s.u32(); n > 0; n--) {
        const module = s.name(); const field = s.name(); const k = s.byte();
        const kind = KINDS[k];
        if (!kind) throw Error(`import kind ${k}`);
        if (kind === 'func') s.u32();
        else if (kind === 'table') { s.byte(); s.limits(); }
        else if (kind === 'memory') s.limits();
        else if (kind === 'global') { s.valtype(); s.byte(); }
        else { s.byte(); s.u32(); }
        out.imports.push({ module, name: field, kind });
      } break;
      case 3: for (let n = s.u32(); n > 0; n--) out.funcs.push(s.u32()); break;
      case 5: for (let n = s.u32(); n > 0; n--) out.memories.push(s.limits()); break;
      case 7: for (let n = s.u32(); n > 0; n--) {
        const field = s.name(); const k = s.byte(); const kind = KINDS[k];
        if (!kind) throw Error(`export kind ${k}`);
        out.exports.push({ name: field, kind, index: s.u32() });
      } break;
      case 10: for (let n = s.u32(); n > 0; n--) out.bodies.push(s.bytes(s.u32())); break;
      default: break; // tables, globals, start, elements, data, data count: not read here
    }
    out.sections.push({ id, name });
  }
  return out;
}

export const sigText = (s: Sig): string => `(${s.params.join(', ')}) -> (${s.results.join(', ')})`;
/** The number of imported functions: where the defined functions' indices start. */
export const importedFuncs = (p: Parsed): number => p.imports.filter((i) => i.kind === 'func').length;
/** A function's signature by its index in the function index space, or null for an import or an index out of range. */
export function definedSig(p: Parsed, index: number): Sig | null {
  const t = p.funcs[index - importedFuncs(p)];
  return index >= importedFuncs(p) && t !== undefined ? p.types[t] ?? null : null;
}
