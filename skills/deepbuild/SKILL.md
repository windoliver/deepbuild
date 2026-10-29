---
name: deepbuild
description: DeepBuild's tools for an agent session. Use them to ask the person, record what is open, claim your task done and run the checks that decide it. Generated from DeepBuild 0.0.0's Building blocks table; never edit by hand.
version: 0.0.0
---

# DeepBuild

Your word is never evidence; only check results are. Nothing missing or unrun passes. You can't change checks or decisions, and no tool answers, decides or overrules. This skill says when to use each block and what it never does; each tool's schema says what it takes.

Begin each task with deep_status, which shows where your session stands; read it once, since deep_run's answer is the run's outcome and no verdict appears until the checks are judged. Predict before you run: declare your claim with what you expect each check to show, then run the checks. Make each call once, never again with the same input. When the hub is unreachable, nothing was recorded; call again once it is back.

## Event

- deep_search. Search your wiki, past decisions and the project's spec, and in your own session its open items and verdicts, read only; every hit names its source.

Never: Written under another writer's name, changed or deleted.

## Claim

- deep_claim. Declare your task done at a commit, with what you expect each check to show before it runs; the checks then decide.

Never: Given a verdict by its own agent.

## Check

- deep_propose. Propose a change you may not make yourself, such as to a wiki page, a rule, a check or a spec, with what it rests on; it waits in the person's inbox, and nothing changes until they apply it.
- deep_run. Run a check the repo's spec names, for your claim at its commit; it answers with the run's outcome and its evidence once the run finishes.

Never: Edited once protected, or the only cover for a claim when that claim's agent wrote it.

## Verdict

- deep_status. Read where your session stands: the hub's gates, and each of your claims with its runs, its verdict and any run that contradicts what you predicted.

Never: Written by an agent or an extension, or a PASS resting on a model's judgment alone: each assertion names its oracle, code, model or person.

## Ask

- deep_ask. Ask the person what only they can answer, a taste call or a choice, or raise a task only a person can do, naming the check that will prove it done. It waits for the answer and returns it, or says it is still waiting, with the ask's deadline and default.
- deep_wait. Keep waiting on an ask you raised, once deep_ask says it is still waiting.

Never: Answered by an agent, or by an extension except by naming a decision, rule, budget or request of yours that the core checks.

## Decision and rule

- deep_propose. Propose a change you may not make yourself, such as to a wiki page, a rule, a check or a spec, with what it rests on; it waits in the person's inbox, and nothing changes until they apply it.

Never: Applied or widened by an agent.

## Evidence and open item

- deep_open_item. Record what is still open on your task, such as a kind or a field a piece needs that does not exist, instead of working around it.
- deep_evidence. Attach a file from your working folder as evidence, stored by its hash.

Never: An open item closed by its own agent without evidence.

## Spec

- deep_propose. Propose a change you may not make yourself, such as to a wiki page, a rule, a check or a spec, with what it rests on; it waits in the person's inbox, and nothing changes until they apply it.

Never: In force before you approve it.

## Task definition of done

- deep_status. Read where your session stands: the hub's gates, and each of your claims with its runs, its verdict and any run that contradicts what you predicted.
- deep_propose. Propose a change you may not make yourself, such as to a wiki page, a rule, a check or a spec, with what it rests on; it waits in the person's inbox, and nothing changes until they apply it.

Never: Drafted from the working session's work, or changed by it.

## Environment and lease

- deep_env. Bring your worktree's own stack up, on ports leased to that worktree, ready only once its health route answers, or take it down; every process runs through the supervisor.

Never: A process stopped that DeepBuild can't prove it started.

## Screen and panel

- deep_propose. Propose a change you may not make yourself, such as to a wiki page, a rule, a check or a spec, with what it rests on; it waits in the person's inbox, and nothing changes until they apply it.

Never: Drawn over the question card, run past its grant, painted in the status colors except through a status binding, pushed to you, or taken as proof.

## Index

- deep_search. Search your wiki, past decisions and the project's spec, and in your own session its open items and verdicts, read only; every hit names its source.

Never: The source of truth; the wiki's pages are.

## Source and reading

- deep_search. Search your wiki, past decisions and the project's spec, and in your own session its open items and verdicts, read only; every hit names its source.

Never: Called from a panel or past its quota, or a reading without its source and as-of time, or a tool not counted as read.
