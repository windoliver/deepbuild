import type { HubEvents, HubRuntime, HookSchedule } from './hub-capabilities.js';
import { HumanAnswers } from './human-answers.js';
import { TrustedActions } from './trusted-actions.js';
import { EvidenceAccess } from './evidence-access.js';
import { HubReadings } from './hub-readings.js';
import { WorkspaceActions } from './workspace-actions.js';
import type { HumanControlPort } from './human-control-port.js';
import type { AnswerDeliveryPort, StopJudgingPort, SessionMemoryPort, TranscriptsPort, SessionStatePort, McpOperationsPort } from './hub-ports.js';

import { realpathSync } from 'node:fs';

import { Numbers } from './numbers.js';
import { homedir } from 'node:os';

import { type Asks } from '@deepbuild/asks';

import { type Evidence, type EvidenceStore, type PutResult } from '@deepbuild/evidence';
import { type ExtensionHost, type ViewShown } from '@deepbuild/extension-host';
import { type RecordStore } from '@deepbuild/record';

import { type Checkouts } from '@deepbuild/gate';

import { Acceptance } from './acceptance.js';
import type { Landing } from './landing.js';
import { type JobSpec, type Runner, type WindowReport } from '@deepbuild/runner';

import { ClaudeSettings } from './claude-settings.js';

import { Confirmer } from './confirm.js';

import { rejectedDirections, syncRejected } from './memory.js';
import { AskTasks } from './ask-tasks.js';

import { Staging } from './staging.js';

import { creditOf, reachOf as ruleReach, reachSince } from './rules.js';

import { type Root } from './paths.js';
import { People } from './people.js';

import type { WikiBuild, KnowledgeProvider } from './knowledge-port.js';
import { Teardowns } from './teardowns.js';
import { Agents } from './agents.js';
import { Box } from './box.js';

import { Channels, type ChannelAsk } from './channels.js';
import type { WorkspaceService } from './workspaces-port.js';
import { Devices } from './trusted.js';

import { OpenItems } from './open-items.js';

import { Runs } from './runs.js';
import type { CheckKinds } from './checks-port.js';

import { Stacks } from './stacks.js';
import { Starts } from './starts.js';

import { HeavyQueue } from './heavy.js';

import { LogReads } from './log-reads.js';
import { Hosts } from './hosts.js';
import { Jobs } from './jobs.js';
import { Libraries } from './libraries.js';

import { type Durable } from './vfs.js';
import { refuse, Refused, refusal, type CoreOptions } from './wire.js';
import { reported } from './setup-steps.js';
import type { CallContext } from './session-types.js';
import { HubCanvas } from './hub-canvas.js';

import { type Obj } from "./hub-shared.js";

export interface HubControlOptions {
  settings: CoreOptions & { forge: string };
  services: {
    readonly wikiWritten: KnowledgeProvider['writtenOf'];
    readonly log: LogReads;
    readonly people: People;
    readonly numbers: Numbers;
    readonly staging: Staging;
    readonly agents: Agents;
    readonly box: Box;
    readonly extensions: ExtensionHost | undefined;
    readonly runs: Runs;
    readonly hosts: Hosts;
    readonly sessionStarts: Starts;
    readonly heavy: HeavyQueue;
    readonly wikiBuild: WikiBuild;
    readonly raw: RecordStore['raw'];
    readonly root: Root;
    readonly record: RecordStore;
    readonly now: () => number;
    readonly acceptance: Acceptance;
    readonly landing: Landing;
    readonly runner: Runner;
    readonly checkKinds: CheckKinds;
    readonly canvasSide: HubCanvas;
    readonly spaces: WorkspaceService;
    readonly asks: Asks;
    readonly tasks: AskTasks;
    readonly claudeSettings: ClaudeSettings;
    readonly store: EvidenceStore;
    readonly devices: Devices;
    readonly confirmer: Confirmer;
    readonly teardowns: Teardowns;
    readonly openItems: OpenItems;
    readonly checkouts: Checkouts;
    readonly channels: Channels | undefined;
    readonly libraries: Libraries | undefined;
    readonly jobKinds: Jobs | undefined;
    readonly durable: Durable;
    readonly stacks: Stacks;
  };
  delivery: () => Pick<AnswerDeliveryPort, "note" | "openOffers" | "placed" | "saveOffered" | "sendBack" | "stopWaiting" | "switches" | "waitAnswer">;
  judging: () => Pick<StopJudgingPort, "lastMessage" | "prOf" | "reachOfSession" | "runEnded" | "stateOf" | "testVerdict" | "turnTaskOf">;
  state: () => Pick<SessionStatePort, "agentAbove" | "entered" | "liveOf" | "notAnAgent" | "renameSession" | "whySeen" | "rowsSeen" | "seeRow" | "seenBy" | "sessionRows" | "sessionWindow" | "sessions" | "startOf" | "states" | "statesSettled" | "statusSeen">;
  memory: () => Pick<SessionMemoryPort, "lessons" | "memoryAct" | "sessionRules" | "syncRules" | "syncStanding">;
  mcp: () => Pick<McpOperationsPort, "checksOf">;
  transcripts: () => Pick<TranscriptsPort, "backfill">;
  events: Pick<HubEvents, "append" | "appendCore" | "appendReading" | "connection">;
kernel: Pick<HubRuntime, "blocked" | "jobs" | "ready">;
schedule: Pick<HookSchedule, "queue" | "replayLate" | "replaying" | "testClock">;

}

/** HubControl: owns its domain state; services are resolved only when used. */
export class HubControl {
  private readonly human: HumanAnswers;
  private readonly authority: TrustedActions;
  private readonly evidence: EvidenceAccess;
  private readonly readings: HubReadings;
  private readonly work: WorkspaceActions;

  constructor(private readonly options: HubControlOptions) {
    const control: HumanControlPort = { trusted: (method, params, context, what, handle, revision) => this.authority.trusted(method, params, context, what, handle, revision), revisionOf: (handle, ask) => this.human.revisionOf(handle, ask) };
    this.human = new HumanAnswers({ settings: options.settings, services: options.services, events: options.events,   delivery: options.delivery, control: () => control, judging: options.judging, mcp: options.mcp, state: options.state, memory: options.memory });
    this.authority = new TrustedActions({ settings: options.settings, services: options.services, events: options.events,   state: options.state, control: () => control });
    this.evidence = new EvidenceAccess({ settings: options.settings, services: options.services, events: options.events,   state: options.state });
    this.readings = new HubReadings({ settings: options.settings, services: options.services, events: options.events, kernel: options.kernel,  judging: options.judging, transcripts: options.transcripts });
    this.work = new WorkspaceActions({ settings: options.settings, services: options.services, events: options.events,   state: options.state });
  }

  /** A promotion's drain (#1334): no session starts until the hub restarts on the new build. */
  private draining = false;

  async dispatch(method: string, params: Obj, context: CallContext): Promise<unknown> {
    switch (method) {
      case 'hub.health':
      case 'health': return this.health();
      case 'session.wait': return this.options.delivery().waitAnswer(params, context);
      case 'session.delivered': return this.options.delivery().placed(params, context);
      case 'session.stop_waiting': return this.options.delivery().stopWaiting(context);
      case 'session.note': return this.options.delivery().note(params);
      case 'test.send_back': return this.options.delivery().sendBack(params);
      case 'test.verdict': return this.options.judging().testVerdict(params);
      case 'test.clock': return this.options.schedule.testClock(params);
      case 'events.read': return this.options.services.log.read(params, this.options.state().seenBy(context.role));
      // Behind the state pass under way, so the rows it holds are the asks as they stand (#1463).
      case 'inbox.read': return this.options.state().statesSettled().then(() => this.options.services.log.reflecting(() => this.human.inbox()));
      case 'sessions.read': return this.options.services.log.reflecting(async () => ({ sessions: await this.options.state().sessionRows(this.options.state().seenBy(context.role)) }));
      case 'person.add': return this.authority.addPerson(params, context);
      case 'library.on': case 'library.off': case 'library.rule': return this.authority.library(method, params, context);
      case 'pack.rule': return this.authority.packRule(params, context);
      case 'job.rule': return this.authority.jobRule(params, context);
      case 'person.invite': return this.authority.invitePerson(params, context);
      case 'person.revoke': return this.authority.revokePerson(params, context);
      // An invite spent over the network (#1338): only the server's network hello calls it, with the key the joining machine proved.
      case 'person.join': {
        if (context.role !== 'network' || typeof params.key !== 'string') throw new Refused(refusal('role', '/method', 'An invite is spent only over the network, by the machine that proves its key.', method));
        const joined = this.options.services.people.redeem(params.invite, params.key);
        if (!joined) throw new Refused(refusal('credential', '/invite', 'This invite is spent, lapsed or not one this hub issued.'));
        return joined;
      }
      case 'numbers.read': return this.options.services.log.reflecting(async () => {
        const read = await this.options.services.numbers.read() as unknown as { rows: unknown[] };
        return { ...read, rows: [...read.rows, await this.human.handbacks()] } as unknown as Obj;
      });
      case 'numbers.baseline': await this.options.state().notAnAgent(context, method); return this.options.services.numbers.baseline(String(params.manifest));
      case 'race.start': return this.authority.race(params, context);
      case 'numbers.refresh': await this.options.state().notAnAgent(context, method); return this.options.services.numbers.refresh();
      case 'numbers.sample': await this.options.state().notAnAgent(context, method); return this.options.services.numbers.sample(Number(params.before), typeof params.manifest === 'string' ? params.manifest : undefined);
      case 'changes.read': return this.readings.change(params);
      case 'evidence.read': return this.evidence.evidence(params);
      case 'ask.answer': return this.answer(params, context);
      case 'ask.card': return this.human.askCard(params);
      case 'decision.overrule': return this.human.overrule(params, context);
      case 'ask.undo': return this.human.undo(params, context);
      case 'ask.take_over': return this.human.takeOver(params, context);
      case 'offer.save': return this.options.delivery().saveOffered(params, context);
      case 'staged.undo': return this.options.services.staging.undo(params);
      case 'agents.propose': await this.options.kernel.ready; return this.options.services.agents.propose(params);
      case 'agents.read': return this.options.services.agents.read();
      case 'box.say': await this.options.kernel.ready; return this.options.services.box.say(String(params.words ?? ''), typeof params.repo === 'string' ? params.repo : undefined);
      case 'agents.restart': await this.options.kernel.ready; return this.options.services.agents.restart(params);
      case 'agents.undo': return this.options.services.agents.undo(params);
      case 'mcp.exec': return this.options.services.agents.exec(params);
      // A hosted terminal the hub keeps past a restart: what the app's tab reads and types into (#70).
      case 'terminal.open': return this.authority.terminal().open(this.options.events.connection('app'), params as unknown as Parameters<ExtensionHost['openTerminal']>[1]);
      case 'terminal.tab': return this.authority.terminal().tab(this.options.events.connection('app'), String(params.terminal)) as unknown as Obj;
      case 'terminal.input': return this.authority.terminal().rawInput(this.options.events.connection('app'), String(params.terminal), String(params.text)).then(() => ({ sent: true }));
      case 'secret.enter': return this.authority.enterSecret(params, context);
      case 'secret.list': return { held: await this.options.services.extensions?.heldSecrets() ?? [] };
      case 'device.pair': return this.authority.pair(params, context);
      case 'device.unpair': return this.authority.unpair(params, context);
      case 'channel.link': return this.authority.link(params, context);
      case 'confirm.enroll': return this.authority.enrollAgain(params, context);
      case 'extension.install': return this.authority.install(params, context);
      case 'you.confirm': return this.authority.confirmCommand(params, context);
      case 'ask.confirm': return this.authority.confirmCard(params);
      case 'views.installed': return { views: this.options.services.extensions?.installedViews() ?? [] };
      case 'command.run': return this.authority.runCommand(params);
      // The app's action table (#1462): Later on an ask, and Pause on a session's row.
      case 'ask.later': return this.human.putOff(params);
      case 'session.pause': return this.human.pauseSession(params);
      case 'session.rename': return this.options.state().renameSession(params);
      // Why a session reads as it does (#2018), behind the state pass under way, as rows.read is.
      case 'row.why':
        this.options.schedule.replayLate();
        return (this.options.schedule.replaying ?? Promise.resolve()).then(() => this.options.schedule.queue(async () => undefined)).then(() => this.options.state().statesSettled()).then(() => this.options.services.log.reflecting(() => this.options.state().whySeen(context.role, params)));
      // A hook that ended before this read is in the row: one deep-hook spooled is replayed first, and one acknowledged has its turn on the core's queue.
      case 'status.read':
        this.options.schedule.replayLate();
        // The state pass under way lands first (#992): what deep status lists is in the record the app draws from.
        return (this.options.schedule.replaying ?? Promise.resolve()).then(() => this.options.schedule.queue(async () => undefined)).then(() => this.options.state().statesSettled()).then(() => this.options.services.log.reflecting(async () => ({ rows: await this.options.state().statusSeen(context.role) })));
      // The list's rows (#1463), as status.read waits for them: behind every hook received and the state pass under way.
      case 'rows.read':
        this.options.schedule.replayLate();
        return (this.options.schedule.replaying ?? Promise.resolve()).then(() => this.options.schedule.queue(async () => undefined)).then(() => this.options.state().statesSettled()).then(() => this.options.services.log.reflecting(() => this.options.state().rowsSeen(context.role, params.detail === true)));
      // A row's page was open a second while you were present (#1461): the row reads as read in every reader.
      case 'row.read':
        if (context.role !== 'app') throw refuse('role', '/method', 'Only the app says a row was seen.', method);
        if (typeof params.id !== 'string') throw refuse('type', '/params/id', 'Name the row by its id.', method);
        return this.options.state().statesSettled().then(() => this.options.schedule.queue(() => this.options.state().seeRow(String(params.id))));
      case 'guard.add': return this.authority.addGuard(params, context);
      case 'evidence.paste': return this.evidence.paste(params);
      case 'run.start': return this.options.services.runs.start(params);
      case 'run.output': return this.options.services.runs.output(params);
      case 'host.list': return { hosts: this.options.services.hosts.names().map((name) => ({ name })) };
      case 'host.facts': return this.options.services.hosts.facts(params.host, params.refresh === true);
      // A root plan you said yes to, for `deep host run`, and what its run left on the host (#1945).
      case 'host.plan': return this.options.services.hosts.plan(params.ask);
      case 'host.ran': return this.options.services.hosts.ran(params.ask, params.run);
      case 'host.changes': return this.options.services.hosts.changes(params.host);
      case 'start.approve': return this.options.services.sessionStarts.approve(params, context);
      case 'start.session':
        if (this.draining) throw refuse('unavailable', '/method', 'A promotion is draining the hub: no session starts until it restarts on the new build. Start it again then.', method, true);
        return this.options.services.sessionStarts.startSession(params, context);
      // A promotion (#1334): the run pauses and its running turns are counted until none is left; the fixture claim
      // judged by this build's own verdict engine; and, on the build that came back, the rollback's one notice.
      case 'hub.drain':
        this.draining = params.on !== false;
        // A turn runs while its session reads working, or waits on a permission prompt, as session.state records it.
        await this.options.state().statesSettled();
        return { turns: [...this.options.state().states.values()].filter((s) => s.startsWith('working/') || s === 'needs you/waiting').length };
      case 'hub.check': return this.readings.healthClaim();
      case 'build.rolled_back': return this.readings.rolledBack(params);
      case 'test.load': return this.readings.testLoad(params);
      case 'record.backup': return this.readings.backup(params);
      case 'lease.wait': return this.options.services.heavy.wait(params, context.peer, () => this.options.state().agentAbove(context.peer)).catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
      case 'lease.started': return this.options.services.heavy.started(params).catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
      case 'lease.exited': return this.options.services.heavy.exited(params).catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
      case 'env.up': return this.work.envUp(params, context);
      case 'env.down': return this.work.envDown(params, context);
      // The steps setup took (#1100), each a `setup.step` event, only as its one list names them.
      case 'setup.report': { let steps; try { steps = reported(params); } catch (e) { throw new Refused(refusal('type', '/params/steps', (e as Error).message, method)); } for (const data of steps) await this.options.events.appendCore('setup.step', data); return {}; }
      case 'wiki.build': {
        const built = await this.options.services.wikiBuild.build();
        await syncRejected(this.options.services.raw, this.options.services.root.dir);
        return built;
      }
      case 'memory.list': return { lessons: await this.options.memory().lessons(), rejected: await rejectedDirections(this.options.services.raw) };
      case 'memory.act': return this.options.memory().memoryAct(params, context);
      // The rules page (#344): written, a scope's reach over the last 30 days, the sessions a rule was given to, a session's set.
      // Behind every hook already received or spooled, so a session that just started is a repo the page reads.
      case 'rules.sync':
        this.options.schedule.replayLate();
        return (this.options.schedule.replaying ?? Promise.resolve()).then(() => this.options.schedule.queue(() => this.options.memory().syncRules()));
      case 'rules.reach': return ruleReach(this.options.services.raw, realpathSync(String(params.repo)), String(params.scope), reachSince(this.options.services.now(), 30));
      case 'rules.credit': return { sessions: await creditOf(this.options.services.raw, String(params.rule)) };
      case 'session.rules': return this.options.memory().sessionRules(params);
      case 'acceptance.start': return this.options.services.acceptance.start(params);
      case 'acceptance.status': return this.options.services.acceptance.status(params);
      case 'acceptance.dispute': return this.options.services.acceptance.dispute(params);
      case 'acceptance.ended': return this.options.services.acceptance.ended(params).then(() => ({ ended: true }));
      // Landing in turn (#1331): `deep land judge`, `deep land` and `deep work --once`, from your own terminal.
      case 'land.judge': return this.work.workspaceCall(() => this.options.services.landing.judgeAll(String(params.repo ?? '')));
      case 'land.round': return this.work.workspaceCall(() => this.options.services.landing.land(String(params.repo ?? '')));
      case 'work.once': return this.work.workspaceCall(() => this.options.services.landing.workOnce(String(params.repo ?? ''), Array.isArray(params.issues) ? params.issues.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0) : []));
      case 'job.submit': return this.options.services.runner.submit(params.spec as JobSpec);
      case 'job.status': return this.options.services.runner.status(String(params.job));
      case 'job.list': return { jobs: await this.options.services.runner.list() };
      case 'checks.kinds': return { kinds: this.options.services.checkKinds.list() };
      case 'job.output': return { stdout: await this.options.services.runner.output(String(params.job)) };
      case 'canvas.show': return this.options.services.canvasSide.showCli(params, context);
      case 'canvas.export': return this.options.services.canvasSide.exportStill(params);
      case 'canvas.revisions': return this.options.services.canvasSide.canvasCall({ call: 'revisions', doc: String(params.doc) });
      case 'canvas.messages': return this.options.services.canvasSide.canvasCall({ call: 'messages', session: String(params.session) });
      case 'canvas.user': return this.options.services.canvasSide.canvasUser(params, context);
      case 'canvas.drawn': return this.options.services.canvasSide.drawnBy(context);
      case 'work.fix': return await this.work.workspaceCall(() => this.work.fixItem(String(params.id ?? ''), typeof params.cwd === 'string' ? params.cwd : homedir()));
      case 'workspace.new': return await this.work.workspaceCall(() => this.options.services.spaces.make(String(params.topic ?? ''), typeof params.folder === 'string' ? params.folder : undefined));
      case 'workspace.move': return await this.work.workspaceCall(() => this.options.services.spaces.move(String(params.id), String(params.folder)));
      case 'workspace.revert': return await this.work.workspaceCall(() => this.options.services.spaces.revert(String(params.id), String(params.commit)));
      case 'workspace.diff': return await this.work.workspaceCall(() => this.options.services.spaces.diff(String(params.id)));
      case 'workspace.drift': return await this.work.workspaceCall(() => this.options.services.spaces.drift(String(params.id)));
      case 'project.views': return { views: this.options.services.extensions!.projectViews() };
      // The app API's views/shown and views/hidden (#262): which views it shows, which decides the while-shown cadences.
      case 'views.shown':
      case 'views.hidden': {
        if (context.role !== 'app') throw refuse('role', '/method', 'Only the app reports the views it shows.', method);
        if (!this.options.services.extensions) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', method, true));
        const report = params as unknown as ViewShown;
        await (method === 'views.shown' ? this.options.services.extensions.viewsShown(this.options.events.connection('app'), report) : this.options.services.extensions.viewsHidden(this.options.events.connection('app'), report))
          .catch((e: Error) => { throw new Refused(refusal('type', '/params', e.message, method)); });
        return { reported: true };
      }
      case 'notifications.report': {
        if (context.role !== 'app') throw refuse('role', '/method', 'Only the app reports its notification setting.', method);
        const setting = params.setting;
        if (setting !== 'allowed' && setting !== 'denied' && setting !== 'alerts_none') throw refuse('type', '/params/setting', 'The setting is allowed, denied or alerts_none.', method);
        this.readings.notifications = setting;
        await this.options.services.asks.notifications(setting !== 'allowed');
        return { reported: true };
      }
      case 'windows.report': return this.options.services.runner.report(params as unknown as WindowReport).then(() => { this.options.services.tasks.windowChanged(); this.options.state().sessionWindow(params); return { reported: true }; });
      default: throw new Refused(refusal('unknown_method', '/method', `The hub serves no method ${method}.`, method));
    }
  }

  async answer(params: Obj, context: CallContext, channel?: { channel: string; proof: 'device' | 'account_link'; plan_hash: string | null }): Promise<Obj> {
    const result = await this.human.answer(params, context, channel);
    // Acknowledging the answer also settles its card/session rows; they must not trail into the next call's effects.
    await this.options.state().statesSettled();
    return result;
  }

  async onSwitchedTree(claim: string): Promise<string | undefined> { return this.human.onSwitchedTree(claim); }

  async didIt(handle: string, session: string, data: Obj): Promise<void> { return this.human.didIt(handle, session, data); }

  async raiseTask(session: string, agent: string, ask: Obj): Promise<void> { return this.human.raiseTask(session, agent, ask); }

  async channelAsks(): Promise<ChannelAsk[]> { return this.human.channelAsks(); }

  hubId(): string { return this.authority.hubId(); }

  async trusted(method: string, params: Obj, context: CallContext, what: string, handle: string, revision: string): Promise<void> { return this.authority.trusted(method, params, context, what, handle, revision); }

  async panelKits(id: string, unrun = false): Promise<string | undefined> { return this.authority.panelKits(id, unrun); }

  async job(args: Obj, caller: string | undefined): Promise<Obj> { return this.authority.job(args, caller); }

  async keep(bytes: Uint8Array, source: string): Promise<string> { return this.evidence.keep(bytes, source); }

  async stored(put: PutResult, what: string): Promise<Evidence> { return this.evidence.stored(put, what); }

  async attach(session: string, args: Obj): Promise<Obj> { return this.evidence.attach(session, args); }

  async retain(): Promise<void> { return this.evidence.retain(); }

  async notifierGone(): Promise<void> { return this.readings.notifierGone(); }

  async health(): Promise<Obj> { return this.readings.health(); }

  async forgeRepos(): Promise<string[]> { return this.readings.forgeRepos(); }

  async enteredProject(session: string, cwd: string): Promise<void> { return this.work.enteredProject(session, cwd); }

  async leftProject(session: string): Promise<void> { return this.work.leftProject(session); }
}
