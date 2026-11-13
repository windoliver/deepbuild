import type { HubEvents } from './hub-capabilities.js';
import type { SessionStatePort } from './hub-ports.js';

import { existsSync } from 'node:fs';

import { join } from 'node:path';

import { type ExtensionHost } from '@deepbuild/extension-host';

import { AskTasks } from './ask-tasks.js';

import { Stacks } from './stacks.js';

import { Refused, refusal, type CoreOptions } from './wire.js';
import type { CallContext } from './session-types.js';

import { letters, type Obj } from "./hub-shared.js";

export interface WorkspaceActionsOptions {
 settings: CoreOptions;
 services: {
readonly tasks: AskTasks;
readonly extensions: ExtensionHost | undefined;
readonly now: () => number;
readonly stacks: Stacks;
 };
 events: Pick<HubEvents, "connection">;

state: () => Pick<SessionStatePort, "agentAbove" | "entered" | "startOf">;
}

export class WorkspaceActions {
 constructor(private readonly options: WorkspaceActionsOptions) {}

  /**
   * A claim's check, run from its approved bytes: read from the evidence store, checked against their digest, and
   * written once under the hub's root by that digest, so a change to the file in the session's folder never runs.
   */
  /**
   * A claim's checks (#29): the validity gate first, with no model, then the gate runner takes its snapshot and its
   * temporary checkout and runs its fast lane; what the stop waits for.
   */
  /** `deep workspace`'s calls (#67): a refusal says why, on the command's stderr. */
  /**
   * `deep fix <id>` (#66): the work item with that ID, from the work sources you switched on, opens its task as a prompt
   * naming it would, whenever it was made; what done means locks from its readings, outside text waiting for your one
   * answer, and a task with no repo lands in a workspace.
   */
  async fixItem(id: string, cwd: string): Promise<{ task: string; link: string }> {
    if (!id) throw Error('deep fix names a work item by its ID');
    let item = await this.options.services.tasks.workItem(id);
    if (!item && this.options.services.extensions) {
      const task = await this.options.services.extensions.fix(this.options.events.connection('cli'), id);
      const readings = (await this.options.services.extensions.workEvents(task.task_ref)).map((e) => ({ ...e.reading, authors: e.reading.authors.map((a) => ({ ...a })) }));
      const main = readings.find((r) => r.source_id === task.id);
      if (main) item = { ...main, readings };
    }
    if (!item) throw Error(`no work source you switched on holds ${id}`);
    const at = this.options.services.now();
    const task_ref = `task:${letters(item.source_id)}`;
    const session = `fix${letters(item.source_id)}`;
    await this.options.services.tasks.opened({ session, agent: 'claude-code', cwd, thread: `fix:${item.source_id}`, task_ref, text: `Fix ${id}`, prompt: `fix:${letters(id)}:${at}`, at, item });
    return { task: task_ref, link: item.link };
  }

  async workspaceCall(call: () => Promise<object>): Promise<Obj> {
    try {
      return { ...await call() };
    } catch (error) {
      throw new Refused(refusal('type', '/params', error instanceof Error ? error.message : String(error)));
    }
  }

  /** A session started in a project that names packs: they load while it's there, if you trust it (#67). */
  async enteredProject(session: string, cwd: string): Promise<void> {
    if (!existsSync(join(cwd, '.deepbuild', 'packs.json'))) return;
    try {
      if ((await this.options.services.extensions!.enterProject(cwd)).trusted) this.options.state().entered.set(session, cwd);
    } catch (error) {
      process.stderr.write(`deep hub: the packs of ${cwd} didn't load: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  async leftProject(session: string): Promise<void> {
    const cwd = this.options.state().entered.get(session);
    if (!cwd) return;
    this.options.state().entered.delete(session);
    await this.options.services.extensions!.leaveProject(cwd).catch(() => undefined);
  }

  // ---- The supervisor's runs: runs.ts.

  // ---- deep env up and down (#331): a worktree's stack through env-local (stacks.ts), every process through the host.

  /** `deep env up`: its leases are held by the agent session whose process runs the command, found by the peer check, or by the core from your own terminal. */
  async envUp(params: Obj, context: CallContext): Promise<Obj> {
    const worktree = this.options.services.stacks.worktreeOf(params);
    return this.options.services.stacks.up(worktree, await this.envCaller(context.peer, worktree));
  }

  /** `deep env down`, for the caller's session or your own terminal (stacks.ts). */
  async envDown(params: Obj, context: CallContext): Promise<Obj> {
    const worktree = this.options.services.stacks.worktreeOf(params);
    return this.options.services.stacks.down(worktree, { path: '/params/worktree', remedy: 'deep env up' }, await this.envCaller(context.peer, worktree));
  }

  /**
   * The agent session a `deep env` caller runs under, or none for your own terminal (#332). A caller whose start can't
   * be read is refused, so a ps failing under load never credits an agent's keys to your terminal.
   */
  private async envCaller(peer: CallContext['peer'], worktree: string): Promise<string | undefined> {
    if (peer && (!peer.start || (await this.options.state().startOf(peer.pid, true)) === undefined)) {
      throw new Refused(refusal('unavailable', '', 'The hub couldn\'t read when the process asking started, so it can\'t tell which session asks; try again.', worktree, true));
    }
    const session = await this.options.state().agentAbove(peer);
    return session ? `mcp:${session}` : undefined;
  }

}
