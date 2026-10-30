#!/usr/bin/env node
// Generates the agent skill (skills/deepbuild/SKILL.md) and each deep_* tool's description (packages/hub/tools.json)
// from the Building blocks table of docs/technical-design.md (#26): every row whose "Agents, through MCP" cell names a
// tool gives that tool's description and the skill its block and what the block never is. Only what a tool can't teach
// goes in the skill, when to use each block and what it never does, and never a tool's parameters, which agents read
// from its schema. tests/acceptance/26 fails when either drifts from the table.
//   node scripts/skill.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** When an agent uses each tool, and what its result does not prove. */
const TOOLS = {
  deep_status: {
    use: 'Read where your session stands: the hub\'s gates, and each of your claims with its runs, its verdict and any run that contradicts what you predicted.',
    proves: 'Its result does not prove your work is done: only a verdict the checks reached says so, and a claim with no verdict is still open.',
  },
  deep_search: {
    use: 'Search your wiki, past decisions and the project\'s spec, and in your own session its open items and verdicts, read only; every hit names its source.',
    proves: 'A hit does not prove what it quotes still holds: it is what its source said, read through an index that is never the source of truth.',
  },
  deep_ask: {
    use: 'Ask the person what only they can answer, a taste call or a choice, or raise a task only a person can do, naming the check that will prove it done. It waits for the answer and returns it, or says it is still waiting, with the ask\'s deadline and default.',
    proves: 'An answer does not prove anything about your work, and a task answered as done does not prove it is: only its check passing does.',
  },
  deep_wait: {
    use: 'Keep waiting on an ask you raised, once deep_ask says it is still waiting.',
    proves: 'Still waiting does not prove the ask was seen; its default applies at its deadline.',
  },
  deep_open_item: {
    use: 'Record what is still open on your task, such as a kind or a field a piece needs that does not exist, instead of working around it.',
    proves: 'Recording an open item does not prove it matters, and you can\'t close your own without evidence.',
  },
  deep_claim: {
    use: 'Declare your task done at a commit, with what you expect each check to show before it runs; the checks then decide.',
    proves: 'A claim does not prove the task is done: the verdict comes from the checks\' runs, and a run that disagrees with your prediction shows as a contradiction.',
  },
  deep_evidence: {
    use: 'Attach a file from your working folder as evidence, stored by its hash.',
    proves: 'Storing a file does not prove what it shows; a path outside your working folder is answered as one that doesn\'t exist.',
  },
  deep_propose: {
    use: 'Propose a change you may not make yourself, such as to a wiki page, a rule, a check or a spec, with what it rests on; it waits in the person\'s inbox, and nothing changes until they apply it.',
    proves: 'A proposal does not prove the change is right, and it is never applied by you or any agent.',
  },
  deep_run: {
    use: 'Run a check the repo\'s spec names, for your claim at its commit; it answers with the run\'s outcome and its evidence once the run finishes.',
    proves: 'One run\'s outcome does not prove your claim passes: only a verdict over the runs a claim needs says so.',
  },
  deep_env: {
    use: 'Bring your worktree\'s own stack up, on ports leased to that worktree, ready only once its health route answers, or take it down; every process runs through the supervisor.',
    proves: 'A stack that is up does not prove any check passes, and a port leased to your worktree is never another worktree\'s: a child session in its own worktree gets its own.',
  },
};

/** Table text as an agent reads it: no backticks or bold. */
const plain = (text) => text.replace(/`|\*\*/g, '');
const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

/** The Building blocks table: each row's block, its "Agents, through MCP" cell and its Never cell. */
export function blocks(design = readFileSync(join(ROOT, 'docs/technical-design.md'), 'utf8')) {
  const lines = design.slice(design.indexOf('\n### Building blocks')).split('\n');
  const head = lines.findIndex((l) => l.startsWith('| Block |'));
  if (head < 0) throw Error('docs/technical-design.md has no Building blocks table');
  const rows = [];
  for (let i = head + 2; lines[i]?.startsWith('|'); i++) {
    const [block, , mcp, , never] = cells(lines[i]);
    rows.push({ block, mcp, never });
  }
  return rows;
}
const naming = (rows, tool) => rows.filter((r) => r.mcp.includes(`\`${tool}\``));

export function generate(rows = blocks()) {
  const descriptions = {};
  for (const [tool, { use, proves }] of Object.entries(TOOLS)) {
    const named = naming(rows, tool);
    if (!named.length) throw Error(`no row of the Building blocks table names ${tool}`);
    descriptions[tool] = [use, proves, ...named.map((r) => `${r.block}, never: ${plain(r.never)}.`)].join(' ');
  }
  const { version } = JSON.parse(readFileSync(join(ROOT, 'packages/hub/package.json'), 'utf8'));
  const used = rows.filter((r) => Object.keys(TOOLS).some((tool) => r.mcp.includes(`\`${tool}\``)));
  const skill = [
    '---',
    'name: deepbuild',
    `description: DeepBuild's tools for an agent session. Use them to ask the person, record what is open, claim your task done and run the checks that decide it. Generated from DeepBuild ${version}'s Building blocks table; never edit by hand.`,
    `version: ${version}`,
    '---',
    '',
    '# DeepBuild',
    '',
    'Your word is never evidence; only check results are. Nothing missing or unrun passes. You can\'t change checks or decisions, and no tool answers, decides or overrules. This skill says when to use each block and what it never does; each tool\'s schema says what it takes.',
    '',
    'Begin each task with deep_status, which shows where your session stands; read it once, since deep_run\'s answer is the run\'s outcome and no verdict appears until the checks are judged. Predict before you run: declare your claim with what you expect each check to show, then run the checks. Make each call once, never again with the same input. When the hub is unreachable, nothing was recorded; call again once it is back.',
    '',
    ...used.flatMap((r) => {
      const tools = Object.keys(TOOLS).filter((tool) => r.mcp.includes(`\`${tool}\``));
      return [`## ${r.block}`, '', ...tools.map((tool) => `- ${tool}. ${TOOLS[tool].use}`), '', `Never: ${plain(r.never)}.`, ''];
    }),
  ].join('\n');
  return { descriptions, skill };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { descriptions, skill } = generate();
  writeFileSync(join(ROOT, 'packages/hub/tools.json'), `${JSON.stringify(descriptions, null, 2)}\n`);
  mkdirSync(join(ROOT, 'skills/deepbuild'), { recursive: true });
  writeFileSync(join(ROOT, 'skills/deepbuild/SKILL.md'), skill);
}
