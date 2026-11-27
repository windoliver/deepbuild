# #3414: each changed line beside the line it replaced

From the merge base `a75e1c56f` to the change, in docs/technical-design.md, docs/canvas-primitives.md, docs/parallel-proof.md, docs/extension-guide.md. Each changed line is shown as the words around each change, 140 characters either side, the changed words between ⟦ and ⟧; a line under 400 characters is shown whole: before, then after. A line that is new has no before.

## docs/technical-design.md

### docs/technical-design.md:30

- Before: `- **The core:** the record, gates, asks and the adapter contract.`
- After: `- **The core:** the record, the contract, capabilities, the trusted path, the floor and verdicts, and asks, as [Building blocks](#blocks) lists them.`

### docs/technical-design.md:89

- Before: `    KER[Kernel: record, contract, capabilities, two rules, trusted path]`
- After: `    KER[Core: record, contract, capabilities, trusted path, floor and verdicts, asks]`

### docs/technical-design.md:110

- Before: | Extensions | Everything beyond the ⟦kernel⟧ and the trusted ring, including the done gate, journeys, resolvers and adapters. The TypeScript modules inside DeepBuild's signed release l…
- After: | Extensions | Everything beyond the ⟦core⟧ and the trusted ring, including the done gate, journeys, resolvers and adapters. The TypeScript modules inside DeepBuild's signed release l…


### docs/technical-design.md:205

- Before: Learning only ever changes a layer that sits on a base it can't touch. The base is the ⟦kernel's⟧ two rules, the four product invariants, the specs you approved, and your decisions and answers. Only you change the base, in words, as a di…
- After: Learning only ever changes a layer that sits on a base it can't touch. The base is the ⟦contract's⟧ two rules, the four product invariants, the specs you approved, and your decisions and answers. Only you change the base, in words, as a di…


### docs/technical-design.md:523

- Before: The ⟦kernel is only a contract, in five parts: the record, the contract itself (the shapes and APIs), capabilities, two rules and the trusted path.⟧ Every outside call DeepBuild itself makes, from the hub or a plug-in, goes through capabilities: a grant, a quota and secrets only by handl…
- After: The ⟦core is the part of DeepBuild that nothing replaces or extends, and it holds six parts: the record, the contract (the shapes and APIs it publishes by version, with its two rules and the adapter contract), capabilities, the trusted path, the floor and verdicts, and asks.⟧ Every outside call DeepBuild itself makes, from the hub or a plug-in, goes through capabilities: a grant, a quota and secrets only by handl…

- Before: …pp shell, the canvas that draws everything on screen, the device and media gate, the supervisor and the installer, the only code beyond the ⟦kernel⟧ that no plug-in can replace. The canvas core inside the ring is built like the hub: a small core, canvas modules as its parts, and data pac…
- After: …pp shell, the canvas that draws everything on screen, the device and media gate, the supervisor and the installer, the only code beyond the ⟦core⟧ that no plug-in can replace. The canvas core inside the ring is built like the hub: a small core, canvas modules as its parts, and data pac…

- Before: … it writes in the WGSL subset are lowered to the core's own steps. Canvas modules are ring code; plug-ins can't replace or extend them. The ⟦core's four kinds of thing (the record, gates, asks and adapters) are what the contract defines, and the done gate, the resolvers and each agent's adapter are plug-ins on it.⟧ Agents and extensions work with the blocks below and nothing else. Every block changes the same way: proposed, checked, approved, recorded,…
- After: … it writes in the WGSL subset are lowered to the core's own steps. Canvas modules are ring code; plug-ins can't replace or extend them. The ⟦done gate is an extension, and so are the resolvers and each agent's adapter: plug-ins on the contract. The gate's floor stays in the core whatever gate is installed (see [First-party extensions](#extensions)), so the gates the core holds are that floor, never the done gate.⟧ Agents and extensions work with the blocks below and nothing else. Every block changes the same way: proposed, checked, approved, recorded,…


### docs/technical-design.md:896

- Before: … go through the hub and the record, never as direct calls between pieces. A manifest also says what it conflicts with or replaces and which ⟦kernel ⟧contract versions it runs on, so a conflicting install is refused, naming the conflict. A piece's handlers, actions and outputs are staged w…
- After: … go through the hub and the record, never as direct calls between pieces. A manifest also says what it conflicts with or replaces and which ⟦⟧contract versions it runs on, so a conflicting install is refused, naming the conflict. A piece's handlers, actions and outputs are staged w…


### docs/technical-design.md:903

- Before: `- **The kernel doesn't compose.** It defines the edges and enforces these rules, and it is never itself a piece of a composition.`
- After: `- **The core doesn't compose.** It defines the edges and enforces these rules, and it is never itself a piece of a composition.`

### docs/technical-design.md:939

- Before: …re. A canvas document's revision hash takes the canonical document's bytes instead, which are stricter (the canvas reference's Revision). A ⟦kernel⟧ fixture gives the RFC 8785 bytes and the SHA-256 of one record of each hashed kind, and the TypeScript and Rust encoders must both produce …
- After: …re. A canvas document's revision hash takes the canonical document's bytes instead, which are stricter (the canvas reference's Revision). A ⟦core⟧ fixture gives the RFC 8785 bytes and the SHA-256 of one record of each hashed kind, and the TypeScript and Rust encoders must both produce …


### docs/technical-design.md:952

- Before: …g-in builds is made of the primitives below. Each one is data with a shape, a rule for what it can never do, and a check that holds it. The ⟦kernel⟧ owns only the contract group. The rest are trusted pieces that ship with the app, or kinds in the canvas core that plug-ins extend with dat…
- After: …g-in builds is made of the primitives below. Each one is data with a shape, a rule for what it can never do, and a check that holds it. The ⟦core⟧ owns only the contract group. The rest are trusted pieces that ship with the app, or kinds in the canvas core that plug-ins extend with dat…


### docs/technical-design.md:960

- Before: - **Checks read only the lowered form.** This is a ⟦kernel⟧ rule. Whatever form a thing arrives in, a check, a gate or the verdict engine reads it only in its one current form: an event after its kin…
- After: - **Checks read only the lowered form.** This is a ⟦contract⟧ rule. Whatever form a thing arrives in, a check, a gate or the verdict engine reads it only in its one current form: an event after its kin…


### docs/technical-design.md:982

New line, an anchor that keeps the old heading's link landing: `<a id="the-contract-kernel"></a>`

### docs/technical-design.md:984

- Before: `### The contract (kernel)`
- After: `### The contract`

### docs/technical-design.md:996

- Before: `**What it is, and its shape:** The only state the kernel keeps: `{id, kind, subject, writer, actor, scope, data, ts}`, with the writer taken from the connection and the actor and scope from its credential, and a `log_pos`, its position in the event log, that the hub assigns at append. Its kinds include these shapes:`
- After: `**What it is, and its shape:** The only state the core keeps: `{id, kind, subject, writer, actor, scope, data, ts}`, with the writer taken from the connection and the actor and scope from its credential, and a `log_pos`, its position in the event log, that the hub assigns at append. Its kinds include these shapes:`

### docs/technical-design.md:1094

- Before: …host you name (see [hosts](#hosts)); leases on two hosts never overlap, and a pool counts on each host. The match forms are closed, and the ⟦kernel⟧ computes overlap from them. A lease is refused while another holder's lease could match the same key, unless both are shared, and a pool re…
- After: …host you name (see [hosts](#hosts)); leases on two hosts never overlap, and a pool counts on each host. The match forms are closed, and the ⟦core⟧ computes overlap from them. A lease is refused while another holder's lease could match the same key, unless both are shared, and a pool re…

- Before: ….gone` when the holder's agent process is gone by ID and start time with no SessionEnd, and each `process.ended` of its run. Overlap is one ⟦kernel⟧ function over two match forms, and it is symmetric. Its tests compare it with a brute-force reference that tries every path of up to four s…
- After: ….gone` when the holder's agent process is gone by ID and start time with no SessionEnd, and each `process.ended` of its run. Overlap is one ⟦core⟧ function over two match forms, and it is symmetric. Its tests compare it with a brute-force reference that tries every path of up to four s…


### docs/technical-design.md:1162

- Before: **Where it sits.** The canvas core is part of the trusted ring. The ⟦kernel⟧ holds the document contract: kinds with versions, stable IDs, and patches recorded with their writer. The canvas core is the only part that…
- After: **Where it sits.** The canvas core is part of the trusted ring. The ⟦core⟧ holds the document contract: kinds with versions, stable IDs, and patches recorded with their writer. The canvas core is the only part that…


### docs/technical-design.md:2820

- Before: …k's fail-open, spool and fail-closed core, the Claude Code adapter, the Stop hold, the verdict engine, the gate runner, command checks, the ⟦kernel's⟧ ask-tasks with the definition lock, a done gate that reads the issue's acceptance criteria and the bootstrap `.deepbuild/done.yaml`, and th…
- After: …k's fail-open, spool and fail-closed core, the Claude Code adapter, the Stop hold, the verdict engine, the gate runner, command checks, the ⟦core's⟧ ask-tasks with the definition lock, a done gate that reads the issue's acceptance criteria and the bootstrap `.deepbuild/done.yaml`, and th…


### docs/technical-design.md:2862

- Before: …never silently. A change to DeepBuild itself has one of three weights. A change to the four invariants in `AGENTS.md`, to a row below or to ⟦a kernel ⟧contract in a way that breaks it is yours to decide: the edit guard refuses the first two unless they arrive as their own approved proposal,…
- After: …never silently. A change to DeepBuild itself has one of three weights. A change to the four invariants in `AGENTS.md`, to a row below or to ⟦the ⟧contract in a way that breaks it is yours to decide: the edit guard refuses the first two unless they arrive as their own approved proposal,…


## docs/canvas-primitives.md

### docs/canvas-primitives.md:184

- Before: `| event | A record event in the kernel's log | an entry in a baked list; a moment in a film | One meaning. |`
- After: `| event | A record event in the core's log | an entry in a baked list; a moment in a film | One meaning. |`

### docs/canvas-primitives.md:304

- Before: `## What the kernel holds`
- After: `## What the core holds for the canvas`

### docs/canvas-primitives.md:306

New line, an anchor that keeps the old heading's link landing: `<a id="what-the-kernel-holds"></a>`

### docs/canvas-primitives.md:308

- Before: `The kernel holds only this contract: document shapes, kinds with versions, stable IDs, patches stamped with their writer, leases, and the events and projections the canvas reads. It never draws. Everything in later sections is the canvas core's, built on this.`
- After: `For the canvas, the core holds only this contract: document shapes, kinds with versions, stable IDs, patches stamped with their writer, leases, and the events and projections the canvas reads. It never draws. Everything in later sections is the canvas core's, built on this.`

### docs/canvas-primitives.md:501

- Before: …left out, each float as the shortest text that reads back to the f32 or f64 its field declares, strings NFC, no insignificant whitespace. A ⟦kernel⟧ fixture gives the canonical bytes and sha256 of a five-item document. These bytes are stricter than the RFC 8785 bytes the hub's own record…
- After: …left out, each float as the shortest text that reads back to the f32 or f64 its field declares, strings NFC, no insignificant whitespace. A ⟦core⟧ fixture gives the canonical bytes and sha256 of a five-item document. These bytes are stricter than the RFC 8785 bytes the hub's own record…


### docs/canvas-primitives.md:695

- Before: `The tech design's kernel row lists five ask kinds and its asks table six; this keeps six, with `definition`.`
- After: `The tech design's core row lists five ask kinds and its asks table six; this keeps six, with `definition`.`

### docs/canvas-primitives.md:1131

- Before: …ord | determinism | card | budget | interval_forms | draw_path, reopens_if: string, instead: string | nothing}` (record: the record and the ⟦kernel's⟧ document contract; draw_path: a shape the core draws as a path; `instead`: what a document can write today in the list's place, such as a k…
- After: …ord | determinism | card | budget | interval_forms | draw_path, reopens_if: string, instead: string | nothing}` (record: the record and the ⟦core's⟧ document contract; draw_path: a shape the core draws as a path; `instead`: what a document can write today in the list's place, such as a k…


## docs/extension-guide.md

### docs/extension-guide.md:7

- Before: …ackage (`conflicts`); one that registers a check kind an installed package holds without declaring it `replaces` it; and one that runs on a ⟦kernel contract version (`kernel`) the kernel⟧ doesn't publish.
- After: …ackage (`conflicts`); one that registers a check kind an installed package holds without declaring it `replaces` it; and one that runs on a ⟦contract version (`kernel`) the core⟧ doesn't publish.


25 changed lines.
