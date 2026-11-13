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

- deep_status. Read where your session stands: the hub's gates; the checks the repo's spec names; your open asks, each with its state, its default and its deadline; your open items; and each of your claims with its runs, its verdict and any run that contradicts what you predicted.
- deep_propose. Propose a change you may not make yourself, such as to a wiki page, a rule, a check or a spec, with what it rests on; it waits in the person's inbox, and nothing changes until they apply it.
- deep_run. Run a check the repo's spec names, for your claim at its commit; it answers with the run's outcome and its evidence once the run finishes.

Never: Edited once protected, or the only cover for a claim when that claim's agent wrote it.

## Verdict

- deep_status, as under Check.

Never: Written by an agent or an extension, or a PASS resting on a model's judgment alone: each assertion names its oracle, code, model or person.

## Ask

- deep_status, as under Check.
- deep_ask. Ask the person what only they can answer, a taste call or a choice, or raise a task only a person can do, naming the check that will prove it done. It waits for the answer and returns it, or says it is still waiting, with the ask's deadline and default.
- deep_wait. Keep waiting on an ask you raised, once deep_ask says it is still waiting.
- deep_root_plan. Propose a root plan for a host, with the script you wrote there, locked by its hash, and each step with its undo or null when it has none. The person reads it, says yes or no, and runs it themselves with deep host run in their own terminal, where sudo asks for their password.

Never: Answered by an agent, or by an extension except by naming a decision, rule, budget or request of yours that the core checks.

## Decision and rule

- deep_propose, as under Check.

Never: Applied or widened by an agent.

## Evidence and open item

- deep_status, as under Check.
- deep_open_item. Record what is still open on your task, such as a kind or a field a piece needs that does not exist, instead of working around it.
- deep_evidence. Attach a file from your working folder as evidence, stored by its hash.

Never: An open item closed by its own agent without evidence.

## Spec

- deep_propose, as under Check.

Never: In force before you approve it.

## Task definition of done

- deep_status, as under Check.
- deep_propose, as under Check.

Never: Drafted from the working session's work, or changed by it.

## Environment and lease

- deep_env. Bring your worktree's own stack up, on ports leased to that worktree, ready only once its health route answers, or take it down; every process runs through the supervisor.

Never: A process stopped that DeepBuild can't prove it started.

## Screen and panel

- deep_propose, as under Check.
- deep_show. Draw a canvas document, a figure, a map, a chart or a sheet, on your own claim, ask or prompt, in your own layer; it answers presented, refused or not presented, with the document's issues and snapshots by hash.
- deep_drive. Drive a replica, a headless copy of the app on a fixture or on a read-only copy of your record. Launch it, act on what you locate by role and name, label or text, open a page by its address, wait for it to settle, see it as text snapshots, screenshots and recordings, and close it to free it. At most two run on a machine, under a lease.

Never: Drawn over the question card, run past its grant, painted in the status colors except through a status binding, pushed to you, or taken as proof.

## Index

- deep_search, as under Event.

Never: The source of truth; the wiki's pages are.

## Source and reading

- deep_search, as under Event.

Never: Called from a panel or past its quota, or a reading without its source and as-of time, or a tool not counted as read.

## Job (R6, with the agent tools for scenes)

- deep_job. List the job kinds and the tools that qualified for each, and run a kind on one tool pinned by name@version, outside the hub's process; a rerun with the same tool, params and input bytes is a cache hit that starts no process.

Never: Run in the canvas core or a frame, change a document, count as a verdict, or hand an item an output before the kind's output checks pass.

## Canvas

- deep_kinds. Look up what this core can draw before you write a document, with the kinds, recipes, packs and registries it has, each with its schema, an example by hash, its stability and whether it is available here; the word another tool uses for one, from a familiar-names pack; and the installed guides and gallery, read in pages.

Never: Drawn outside its panel or over the question card.

## Physics

- deep_show, as under Screen and panel.

Never: Code run per step, a body created mid-run, a GPU simulation's result used in a check, or a claim passed by a clip.

## Media

- deep_show, as under Screen and panel.

Never: Sound that starts without your gesture, a capture without the system picker or the OS permission, or without its indicator, a microphone combined with network access you didn't see, or a voice cloned from evidence.

## Working on a canvas document

Start from a piece recipe, or from a kind deep_kinds lists. Check the document with deep_show before you render it. Then render small and read its issues. Fix by patch, changing one item at a time, and render in full only once the numbers pass; judge by numbers, never by eye. When no kind or field does what the piece needs, raise an open item with deep_open_item naming the missing kind or field, instead of approximating it. When a logic step needs more fuel than its step ceiling, which deep_kinds lists by step rate, budget class and host, split the work across steps and keep the progress in memory. For a formula, run the typeset job with deep_job: it turns LaTeX or Typst into an SVG with one id per term, which a vector@1 item imports, so a step moves the terms two formulas share; never set a formula as text.

## Craft checks a film brief names

A film's brief names the craft@1 checks it wants. Each runs only when the brief names it, holds the film to the brief's thresholds and never yours, and never passes a film on its own.

- shot_length. Each shot's length, read from the timeline, is at least min and at most max seconds: under min fails, past max is a warning and past hard_max fails. Inside a montage span the brief declares (a marker's span), the minimum is that span's own, never under 0.25 s. A brief may declare a signature long take: the first count shots past hard_max, each up to signature.max, pass, and another long take fails, naming it. Threshold — min 2 s, max 6 s, hard_max 8 s; montage min at least 0.25 s; signature: 1 long take up to 20 s, when the brief declares it. Fix — Cut a long shot in two or lengthen a short one into the range, or declare the montage span or the one long take in the brief.
- camera_grammar. Each shot's move is read from its camera's evaluated poses, never from its label; a change in distance or view width over 10% is a push or a pull, an aim turn over 5° a pan, an azimuth sweep over 10° about its kept items an orbit, and less a hold; a move whose camera covers 90% of its path within 0.5 s is an accent. No more than push_run_max pushes in a row, at most accents_max of the shots are accents, and neighbouring shots never share both framing and move. Across a cut between shots that keep a common item, the direction from the camera to that item turns at least angle_min or its framed height changes at least size_min times, or the cut fails as a jump cut naming both shots. With line, every shot's camera stays on the side of the vertical plane through the two items that the first shot takes, or the shot that crosses it fails. Threshold — push_run_max 2; accents_max 0.33 of the shots; neighbours differ; cut_change angle_min 30°, size_min 1.4 times. Fix — Change the named shot's camera move; across a jump cut, turn the camera at least 30° about the shared item or change its framed height at least 1.4 times; keep every camera on the line's first side.
- ends. The first and the last shot aren't text-led: a shot is text-led when, in at least half its frames, a text of at least text_led's words (8) shows, or when a title card is its only subject. Threshold — first and last shots not text-led. Fix — Open and close on picture: move the title or the closing words into a shot whose subject isn't text.
- text_led. At most max of the film's shots are text-led: a shot in at least half of whose frames a text of at least words words shows, or whose only subject is a title card. Past max, each text-led shot is named. Threshold — max 0.30 of the shots; a text of 8 words or more leads its shot. Fix — Show the idea in picture and say it in the narration, or cut the on-screen words under eight.
- look_lock. Every shot is finished in the film's one look, the shot's own look or else the film's, unless the brief names looks: sequence, and every shot's look draws from the first shot's palette. Threshold — looks: one, unless the brief names a sequence; palette: one. Fix — Finish the named shot in the film's look, or name the sequence of looks in the brief.
- recipes. The film's items instantiate at most max distinct pack recipes (explain@1's and piece@1's film recipes once they land); a recipe past max is named with the first shot that frames its instance. Threshold — max 2 recipes. Fix — Write the extra recipe's shots with one of the two recipes the film already uses.
- numbers_in_script. Every number a text shows on screen is also in the words of the script's lines; one that isn't is named with the shot and the frame it first shows in. Threshold — every on-screen number said in the script. Fix — Say the number in the script's line over the shot that shows it, or take it off screen.
- caption_band. Nothing but captions draws in the caption band, the bottom height of the frame: a text whose glyphs reach into it, or an item that starts in it, is named with the shot and the frame it first draws there. Threshold — height 0.15 of the frame. Fix — Move the named item above the caption band.
- motion_share. The share of frame pairs that move, from frame differences at 12 fps, 320 px wide in gray as an export carries it, with the caption band (0.15, or 0.18 on a vertical frame) masked, a pair counted when its mean difference is at least 9 levels: under min fails and under warn is a warning. Left out are the pairs a cut or a cross-fade covers, a jump the camera doesn't make that reads as a cut (at least 8 levels and 3 times the median of the 12 pairs around it, plus 2), and a window of up to 24 pairs whose middle frames are blends of its two ends. A run of blank frames (under 0.2% of pixels on an edge) of blank_max or longer, outside the first and last half second, fails. Threshold — min 0.035, warn 0.06; blank_max 0.3 s; a pair moves at 9 levels. Fix — Add motion inside the shots, a camera move or an animated subject, rather than more transitions; fill a blank stretch with picture.
- accents. Picture and sound land together: each picture accent (a moment tagged accent, or a camera accent) has a sound starting within within frames of it, and each hit (a sound of 0.5 s or less) lands within as many frames of a picture accent. Threshold — within 1 frame. Fix — Move the sound onto the picture's accent, or the accent onto the sound.
- not_example. The film differs from its nearest example (an explain@1 example, or a fixture film the brief names in fixtures) on at least min_differ of six measures: its shot kinds by edit distance, its first shot's kind and look, its signature transition, its camera moves, its tempo map's section shape and its last shot. It compares structure only. Threshold — min_differ 4 of 6 measures. Fix — Change the opening, the moves, the transitions, the sections or the ending the film shares with the example.
- silences. The mix holds at least count_min silences, each at least length_min seconds of 10 ms sub-blocks at or under max_dbfs, and no cue marker sits inside one. Threshold — count_min 2; length_min 0.5 s; max_dbfs −60 per 10 ms sub-block; a cue inside one is refused. Fix — Clear every bus for half a second at least twice, and move any cue out of the silence.
- sound_coverage. Every moment tagged action has a sound starting within within frames of it, and each section (the whole film when it has none) has an ambience, a foley and a music bed playing through at least half of it. Threshold — actions within 1 frame; beds: ambience, foley and music in each section. Fix — Start the action's sound on its moment, and give the named section the missing bed.
- sound_bridges. At least count_min cuts are bridged by a sound that plays across the cut, starting at least lead_or_tail seconds before it or ending at least lead_or_tail after it. Threshold — count_min 2; lead_or_tail 0.25 s. Fix — Start the next shot's sound a quarter second before the cut, or let the last shot's sound tail past it.
- mix.balance. Over each shot, the music bus's power in its lowest band (20 to 120 Hz) is at most low_max dB and in its air band (8 kHz and up) at most air_max dB against its mids (500 to 2000 Hz), from the bus as the export mixes it. Threshold — bands 20, 120, 500, 2000, 8000 Hz; low_max −3 dB; air_max −15 dB. Fix — Cut the music's lows or its air with the bus's EQ until both bands are under their limits.
- sound_lock. Every score instrument is one the brief's sound palette (instruments) lists, named with the shot of its first note; without a palette it is BLOCKED. Threshold — instruments: the brief's sound palette. Fix — Use an instrument the palette names, or change the brief's palette.
