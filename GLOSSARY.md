# DeepBuild

The real names DeepBuild's design and code use for the work an agent does for you and for how that work is proven done. Three other lists hold the words kept elsewhere, and no word a person sees on screen is listed under Avoid here:

- Canvas words: the canvas reference, under [One word per idea](docs/canvas-primitives.md#one-word-per-idea).
- The state words a person sees: the technical design, under [States people see](docs/technical-design.md#states-people-see).
- The plain words on the page, the card and notices: [contracts/plain-words.json](contracts/plain-words.json).

## Language

### What you ask for

**Prompt**:
Words given to an agent to act on, at the start of a turn or while it works. Most are typed by you; some come from a schedule or another agent.
_Avoid_: ask

**Task**:
Something you asked for, with its own definition of done. It comes from a prompt you typed or from a work item.
_Avoid_: ask-task, ask, ticket

**Agent task**:
An item on an agent's own list of things to do, with no definition of done. Marking it complete is the agent's word, and it always keeps the word agent.

**Work item**:
One item in a place where work comes from, such as an issue on a forge. A task can come from one.
_Avoid_: ticket; issue, unless it is the forge's own

**Work run**:
A set of tasks DeepBuild works through under one approval of yours, with no person starting each one.
_Avoid_: run (alone)

**Attempt**:
One agent's try at a task, from its start to how it ended. A switch of agent, model or account starts a new attempt.
_Avoid_: run

### Sessions

**Session**:
One conversation with an agent, under the ID the agent gives it.

**Thread**:
The sessions that continue one another through a clear, a compaction or a fork, under which tasks open. Thread alone means only this; a chat thread or a mail thread says which.

**Turn**:
An agent's stretch of work, from a prompt until its stop is allowed to end it.

**Stop**:
The moment an agent stops a turn. DeepBuild may hold it while checks run, and its reply either lets the turn end or keeps the agent working.

**Hand-back**:
A turn's end that leaves the next move to you. A turn's end in a session that keeps itself going is not one.

**Send-back**:
DeepBuild's reply to a stop that returns a claim to the agent, naming what failed.

**Child session**:
A session that another session started, such as a subagent or a teammate.

**Lead**:
A session that has started child sessions.

### Proving it done

**Definition of done**:
The requirements a task must meet, drafted from what you asked and the code as it was, then locked. It is never drafted from the agent's work.
_Avoid_: spec

**Requirement**:
One line of a definition of done: something that must hold, with the observation that would refute it.
_Avoid_: criterion

**Criterion**:
One line of a work item that says what must hold for the item to be finished. Requirements are drafted from criteria.
_Avoid_: requirement

**Claim**:
The assertion that a task is done, raised when an agent stops after doing work on it or says so itself. It proves nothing until it gets a verdict.

**Gate**:
A point where a claim is held until it passes. Gate alone means only this.
_Avoid_: check

**Done gate**:
The extension that holds a claim when an agent stops and judges it against its task's definition of done.

**Validity gate**:
The gate a claim passes before any check runs: what its definition says it must deliver exists, and everything it cites was read or run. It is part of the floor, and it is not a check.
_Avoid_: validity check

**Floor**:
The part of judging a claim that stays in the core, whatever done gate is installed and even with none. The validity gate belongs to it.

**Check**:
One test a gate runs on a claim, with a result that can fail.
_Avoid_: gate

**Run**:
One execution of one check. Run alone means only this.
_Avoid_: attempt

**Evidence**:
A file the record keeps by its content hash, labelled with who put it there: DeepBuild, you or an agent. Only evidence a check produced can support a verdict.

**Proof**:
What a check's result gives a requirement, at a depth; an agent's statement is never proof. A machine-checked proof always keeps its qualifier.

**Depth**:
How close to real use a proof comes: a unit test, an integration test, a journey or a live run. A deeper proof satisfies a shallower requirement, never the reverse.

**Oracle**:
What decides whether a check's result is right: code, a model or a person.

**Receipt**:
DeepBuild's account of one finished thing, a verdict, an export or a send: what was done, line by line, and what each line rests on. A seller's receipt always says so.

**Open item**:
One thing a claim left open, with what would close it.

### Verdicts

**Verdict**:
What a gate concludes about a claim: PASS, FAIL, INVALID, BLOCKED or INCONCLUSIVE. Only the core makes one, never an agent or an extension.

**PASS**:
Every requirement is covered by a check that ran and held.

**FAIL**:
A check failed on every real run.

**INVALID**:
A check proves nothing, or a requirement has none: the check ran nothing, can't fail, or, for a fix, also passes without the fix.

**BLOCKED**:
A check is missing something outside the change, or already fails without the change.

**INCONCLUSIVE**:
The runs can't decide: too few clean runs, both passes and failures, or only the agent's own checks cover a requirement.

### Asks and answers

**Ask**:
Something raised for you to decide, with a deadline and a default. A standing rule may answer it before it reaches you.
_Avoid_: question; ask, for anything else

**Unblock ask**:
An ask for a step only you can take.
_Avoid_: unblock task

**Question**:
What an agent ends a turn on when it wants an answer. It becomes an ask only if it needs you; otherwise it goes back to the agent.
_Avoid_: ask

**Plan**:
The exact steps an ask shows you before you say yes to it: what each changes, how to undo it and what it costs. Plan alone means only this; any other plan names its owner, as in account plan, lead's plan and agent's plan.

**Decision**:
Your answer to one ask, saved, which makes it a standing rule. A choice recorded in the design's Decided table is a design decision, not this.

**Standing rule**:
Anything of yours that answers later asks without asking you: a decision, or a rule you accepted or set.
_Avoid_: rule (alone), standing grant

**Budget**:
Money you approved for paid runs, up to a cap. Budget alone means only this; any other limit says what it limits.

### The record

**Record**:
What DeepBuild keeps of everything that happened: an append-only log of events, and the evidence they cite.

**Event**:
One entry in the record: something that happened, with the writer its connection proved. Events are only ever added.

**Reading**:
A value read from a source, kept with its unit, its source and its as-of time. It informs and is never a verdict.

**Lease**:
A holder's right to use one resource, such as a port, a test account or a set of paths, until the holder ends. A lease is acquired and held, never granted.
_Avoid_: reservation

### Access

**Access**:
What a package may reach, written in words from a closed list, such as files, hosts or the record.

**Grant**:
The access you approved for one package, as its install card showed it. Grant means only this.
_Avoid_: standing grant; grant, for a lease

**Permission**:
What an agent's own harness or the operating system asks for before an action. What DeepBuild raises from an agent's is an ask, and what you approve is a decision, a standing rule or a grant.

**Trusted path**:
The ways your answer reaches DeepBuild that prove it is yours: the app, the command line once the operating system confirms you, or a phone you paired. An answer that saves a decision needs it.

### Layers

**Core**:
The part of DeepBuild that nothing replaces or extends: the record, the floor and verdicts, asks and the adapter contract. The canvas core is another thing, a part of the trusted ring.
_Avoid_: kernel

**Contract**:
The shapes and rules the core publishes, by version, that every extension is held to.

**Hub**:
The one process per user that hosts the core and the extensions. It is the only writer to the record.

**Trusted ring**:
The code beyond the core that no extension can replace: the app shell, the canvas core, the device and media gate, the supervisor and the installer.

**Device and media gate**:
The part of the trusted ring that lets sound, the screen, the camera and the microphone be used only when you allow it. Its sound half is the device gate, and neither holds a claim, so neither is ever just a gate.

**Extension**:
Anything beyond the core and the trusted ring, such as the done gate, a journey, a resolver or an adapter.
_Avoid_: plug-in

**Package**:
The folder an extension ships and installs as: a manifest and its code.
_Avoid_: pack

**Adapter**:
An extension that connects one agent to DeepBuild: it turns what the agent does into events and delivers answers back into its sessions.

**Resolver**:
An extension that answers an ask for you, only by naming something of yours that covers it, such as a standing rule or a budget.
