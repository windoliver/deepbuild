import type { HubEvents } from './hub-capabilities.js';
import type { SessionStatePort } from './hub-ports.js';

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { isAbsolute, join } from 'node:path';

import { type ExtensionHost } from '@deepbuild/extension-host';
import { type RecordStore } from '@deepbuild/record';

import { Confirmer } from './confirm.js';

import { addGuards } from './guards.js';

import { toolClasses } from './hookmap.js';

import { deepHook, forgeOf, projectIdOf, type Root } from './paths.js';
import { inviteText, People } from './people.js';
import { identityAt } from './identity.js';

import { Channels } from './channels.js';
import { enterSlackToken } from './reach.js';

import { checkKey, Devices } from './trusted.js';

import { panelKit } from './panels.js';
import { plantedReload } from './plant.js';

import { Jobs } from './jobs.js';
import { Libraries, LibraryRefused, LIBRARY_HOST_QUOTA, libraryHosts } from './libraries.js';
import { readPack } from './packs.js';

import { refuse, Refused, refusal, ulid, type CoreOptions } from './wire.js';
import type { CallContext } from './session-types.js';
import { HubCanvas } from './hub-canvas.js';
import { AUTHORITY, type Obj, isObj, writing } from "./hub-shared.js";
import type { HumanControlPort } from './human-control-port.js';
export interface TrustedActionsOptions {
 settings: CoreOptions;
 services: {
readonly devices: Devices;
readonly now: () => number;
readonly confirmer: Confirmer;
readonly extensions: ExtensionHost | undefined;
readonly channels: Channels | undefined;
readonly people: People;
readonly libraries: Libraries | undefined;
readonly canvasSide: HubCanvas;
readonly record: RecordStore;
readonly root: Root;
readonly jobKinds: Jobs | undefined;
 };
 events: Pick<HubEvents, "connection" | "append">;

state: () => Pick<SessionStatePort, "agentAbove">;
 control: () => Pick<HumanControlPort, "revisionOf">;
}

export class TrustedActions {
 constructor(private readonly options: TrustedActionsOptions) {}

  // ---- Answers on the trusted path (#24, #34).

  private hub: string | undefined;

  /** The hub's ID, as its hello names it (#1338): what an invite and a device's signature name (#1579). */
  hubId(): string {
    return (this.hub ??= identityAt(join(this.options.settings.root, 'hub.key'), 'deep-hub').id);
  }

  /**
   * Whether an answer may count: a paired device's valid signature for this method, this hub and these params (#1579),
   * from any role; otherwise, from the CLI alone, the OS confirming you with a prompt that names what you answer. The
   * control token and the peer check alone never make one count, and a deep command run inside an agent's process
   * tree acts as that agent's session, signed or not (#1606): a command an agent starts runs as you, so a signature it
   * carries proves nothing about who answered.
   */
  async trusted(method: string, params: Obj, context: CallContext, what: string, handle: string, revision: string): Promise<void> {
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent && this.options.settings.plant !== 'answer-inside-session') {
      throw new Refused(refusal('role', '/params/ask', `${handle} stays open: this deep command runs inside agent session ${agent}'s process tree, so it acts as that session, and no agent answers an ask${params.signature !== undefined ? ', whatever it signs' : ''}. Answer it from your own terminal or on the question card.`, handle));
    }
    if (params.signature !== undefined) {
      // A write with a request ID spends the signature's once-only ID as it ends: a crash before it commits spends none (#1577).
      const write = writing.getStore();
      const why = this.options.services.devices.verify(params.signature, { method, hub: this.hubId(), params, now: this.options.services.now() }, { skipsTime: this.options.settings.plant === 'signature-skips-time', ...(write?.receipt && !write.done ? { spentAfter: write.after } : {}) });
      if (!why) return;
      const signed = (params.signature as { signed?: Obj }).signed;
      throw new Refused(refusal('credential', why.field === 'signature' ? '/params/signature/sig' : `/params/signature/signed/${why.field}`, `${handle} stays open: the signature's ${why.field} doesn't hold (${why.reason}). Sign it again with a device you paired, for ${method} on this hub, over exactly the params it sends.`, signed?.[why.field] ?? why.field));
    }
    if (context.role !== 'cli') throw new Refused(refusal('unconfirmed', '/params/signature', `${handle} stays open: an answer from the app counts only when a device you paired signs it.`, handle));
    const plant = this.options.settings.plant;
    if (plant === 'answer-on-token' || plant === 'answer-on-peer-check') return;
    const why = await this.options.services.confirmer.you(what, { handle, revision, process: context.peer });
    if (why) {
      throw new Refused(refusal('unconfirmed', '/params/ask', `${handle} stays open: the OS didn't confirm you (${why}). An answer from the CLI counts only once it does; answer again and confirm, or answer on the question card.`, handle, true));
    }
  }

  /**
   * A new secret for a package, on the trusted path (#70): it counts as an answer does, so a deep command in an agent's
   * process tree can't add one, and goes straight to the OS secret store. Neither the value nor anything made from it
   * is recorded.
   */
  async enterSecret(params: Obj, context: CallContext): Promise<Obj> {
    const { extension, name, value } = params;
    if (typeof extension !== 'string' || typeof name !== 'string' || typeof value !== 'string' || !value) throw new Refused(refusal('required', '/params', 'Name the package and the secret, and give its value.', null));
    // A channel's token or the Slack connector's (#1606): `deep secret add channels <channel>` or `deep secret add slack token`.
    if (extension === 'channels' || extension === 'slack') {
      const what = extension === 'slack' ? "the Slack connector's token" : `the token of the channel ${name}`;
      const channels = this.options.services.channels;
      if (extension === 'channels' && !channels) throw new Refused(refusal('unavailable', '', 'The hub has no channels yet; try again once it is ready.', name, true));
      await this.trusted('secret.enter', params, context, `add ${what}`, `secret:${extension}/${name}`, name);
      await (extension === 'slack' ? enterSlackToken(this.options.services.root.dir, value) : channels!.enterToken(name, value)).catch((e: Error) => { throw new Refused(refusal('unavailable', '/params/name', `${what} wasn't saved: ${e.message}.`, name)); });
      return { saved: true, test: 'untested' };
    }
    if (!this.options.services.extensions) throw new Refused(refusal('unavailable', '/params/extension', `${extension} isn't loaded, so nothing can name ${name}.`, extension));
    await this.trusted('secret.enter', params, context, `add the secret ${name} for ${extension}`, `secret:${extension}/${name}`, name);
    const { saved, test } = await this.options.services.extensions.enterSecret(this.options.events.connection('cli'), extension, name, value);
    return { saved, test };
  }

  terminal(): { open: ExtensionHost['openTerminal']; tab: ExtensionHost['tab']; rawInput: ExtensionHost['rawInput'] } {
    const host = this.options.services.extensions;
    if (!host) throw new Refused(refusal('unavailable', '/method', 'This hub hosts no terminals: its extension host isn\'t open.', null));
    return { open: (c, spec) => host.openTerminal(c, spec), tab: (c, t) => host.tab(c, t), rawInput: (c, t, text) => host.rawInput(c, t, text) };
  }

  /** Pairs a device's key, once the OS confirms you, so the control token alone can't pair one. */
  async pair(params: Obj, context: CallContext): Promise<Obj> {
    if (typeof params.name !== 'string' || !params.name) throw new Refused(refusal('required', '/params/name', 'Name the device you pair.', params.name));
    const key = checkKey(params.public_key);
    const why = await this.options.services.confirmer.you(`pair “${params.name.slice(0, 80)}” with DeepBuild, so what it signs answers for you`, { handle: `device:${params.name.slice(0, 80)}`, revision: key, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was paired: the OS didn't confirm you (${why}).`, params.name, true));
    const device = `device:${ulid(this.options.services.now())}`;
    this.options.services.devices.pair(device, params.name, key, this.options.services.now());
    return { device };
  }

  /** Unpairs a device you paired, on the trusted path (#65): its signatures count for nothing, and it is told so. */
  async unpair(params: Obj, context: CallContext): Promise<Obj> {
    const device = params.device;
    if (typeof device !== 'string' || !/^device:[0-9A-Za-z]+$/.test(device)) throw new Refused(refusal('pattern', '/params/device', 'Name the device as device:<id>, as device.pair returned it.', device));
    if (!this.options.services.devices.keyOf(device)) throw new Refused(refusal('not_found', '/params/device', `No paired device ${device}.`, device));
    await this.trusted('device.unpair', params, context, `unpair ${device}, so what it signs counts for nothing`, device, 'unpair');
    this.options.services.devices.unpair(device, this.options.services.now());
    this.options.services.channels?.unpaired(device);
    return { unpaired: device };
  }

  /** Links your account on a channel, once the OS confirms you (#65): its answers count for "I did it", taste and choice. */
  async link(params: Obj, context: CallContext): Promise<Obj> {
    const { channel, account } = params;
    if (typeof channel !== 'string' || !/^[a-z][a-z0-9-]*$/.test(channel)) throw new Refused(refusal('pattern', '/params/channel', 'Name the channel as it registered.', channel));
    if (typeof account !== 'string' || !account || account.length > 200) throw new Refused(refusal('type', '/params/account', 'Name your account on the channel.', account));
    const why = await this.options.services.confirmer.you(`link the account ${account} on ${channel}, so its "I did it", taste and choice answers count`, { handle: `channel:${channel}`, revision: account, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was linked: the OS didn't confirm you (${why}).`, channel, true));
    if (!this.options.services.channels) throw new Refused(refusal('unavailable', '', 'The hub has no channels yet; try again once it is ready.', channel, true));
    this.options.services.channels.link(channel, account);
    return { channel, account };
  }

  /**
   * A person joins a project (#1337): the owner names them and a clone of the project's repo, whose forge identity is the
   * project, so every clone of it reads as one. Once the OS confirms the owner, the person's credential comes back
   * once; the hub keeps only its digest. A repo with no remote keeps its path scope, so it can't be shared.
   */
  async addPerson(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A person is added from your own terminal, once the OS confirms you.', 'person.add'));
    const { person, repo } = params;
    if (typeof person !== 'string') throw new Refused(refusal('type', '/params/person', "Name the person as their forge login.", person));
    if (typeof repo !== 'string' || !isAbsolute(repo)) throw new Refused(refusal('type', '/params/repo', "Name a clone of the project's repo by its absolute path.", repo));
    const forge = forgeOf(repo);
    if (!forge) throw new Refused(refusal('not_found', '/params/repo', `${repo} is in no repo with an origin remote: a repo with no remote keeps its path scope, so it can't be shared.`, repo));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nobody was added: this deep command runs inside agent session ${agent}'s process tree, and no agent adds a person. Run it from your own terminal.`, 'person.add'));
    const what = `add ${person} to ${forge}`;
    const why = await this.options.services.confirmer.you(what, { handle: `person:${person}`, revision: forge });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, 'person.add', true));
    try {
      return this.options.services.people.add(person, forge);
    } catch (error) {
      throw new Refused(refusal('pattern', '/params/person', `Nobody was added: ${error instanceof Error ? error.message : String(error)}.`, person));
    }
  }

  /**
   * A one-time invite to the project of a clone's repo (#1338): the address the person's machine reaches this hub at,
   * which the inviter knows and the hub can't, this hub's ID, which that machine checks before it sends anything, and a
   * secret kept here only as its digest. No address lives in the repo. Asked once the OS confirms you, as adding is.
   */
  async invitePerson(params: Obj, context: CallContext): Promise<Obj> {
    const { person, repo, address } = params;
    if (typeof person !== 'string') throw new Refused(refusal('type', '/params/person', 'Name the person as their forge login.', person));
    if (typeof repo !== 'string' || !isAbsolute(repo)) throw new Refused(refusal('type', '/params/repo', "Name a clone of the project's repo by its absolute path.", repo));
    if (typeof address !== 'string' || !/^[^\s:]+:\d{1,5}$/.test(address)) throw new Refused(refusal('pattern', '/params/address', "Name where the person's machine reaches this hub, as <host>:<port>.", address));
    const forge = forgeOf(repo);
    if (!forge) throw new Refused(refusal('not_found', '/params/repo', `${repo} is in no repo with an origin remote: a repo with no remote keeps its path scope, so it can't be shared.`, repo));
    await this.asYou(context, 'person.invite', `invite ${person} to ${forge}`, `invite:${person}`, forge);
    try {
      const secret = this.options.services.people.invite(person, forge);
      return { invite: inviteText({ v: 1, address, hub: this.hubId(), secret, project: forge, person }), person, project: projectIdOf(forge) };
    } catch (error) {
      throw new Refused(refusal('pattern', '/params/person', `Nobody was invited: ${error instanceof Error ? error.message : String(error)}.`, person));
    }
  }

  /** Revokes a person's credentials and open invites (#1338); the server then closes their connections. */
  async revokePerson(params: Obj, context: CallContext): Promise<Obj> {
    const { person } = params;
    if (typeof person !== 'string' || !person) throw new Refused(refusal('type', '/params/person', 'Name the person as their forge login.', person));
    await this.asYou(context, 'person.revoke', `revoke ${person}'s credentials`, `revoke:${person}`, person);
    return { person, revoked: this.options.services.people.revoke(person) };
  }

  /** A change to who is on a project counts only from your own terminal, never an agent's, once the OS confirms you. */
  private async asYou(context: CallContext, method: string, what: string, handle: string, revision: string): Promise<void> {
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'Who is on a project changes from your own terminal, once the OS confirms you.', method));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent changes who is on a project. Run it from your own terminal.`, method));
    const why = await this.options.services.confirmer.you(what, { handle, revision });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, method, true));
  }

  /** `deep race <issue>` (#352): you start a race on an issue, so its sessions settle on the first PASS and raise no "keep which?" ask. */
  async race(params: Obj, context: CallContext): Promise<Obj> {
    const issue = Number(params.issue);
    if (!Number.isSafeInteger(issue) || issue < 1) throw refuse('type', '/params/issue', 'Name the issue by its number, such as 79.', params.issue);
    const what = `start a race on issue #${issue}`;
    if (context.role !== 'cli' || !context.peer) throw new Refused(refusal('unconfirmed', '/method', `No race started: ${what} counts only from your terminal, once the OS confirms you.`, 'race.start'));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `No race started: this deep command runs inside agent session ${agent}'s process tree, and only you start a race. Run it from your own terminal.`, 'race.start'));
    // A race keeps an ask from you, so it counts as your decision: once the OS confirms you.
    const why = await this.options.services.confirmer.you(what, { handle: `race:${issue}`, revision: what });
    if (why) throw new Refused(refusal('unconfirmed', '/params/issue', `No race started: the OS didn't confirm you (${why}). Run it again and confirm.`, String(issue), true));
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core'), { v: 1, id: ulid(ts), kind: 'race.started', ts, data: { issue } });
    return { issue };
  }

  /**
   * deep-confirm's key set up again, lost or replaced (#880): from the app alone, signed by a device you paired, and
   * counted once you confirm with the new key, when the old one stops counting. The helper's code signature is
   * recorded again with it, so a rebuilt helper counts only from here.
   */
  async enrollAgain(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'app') throw new Refused(refusal('role', '/method', "deep-confirm's key is set up again from the app, on the trusted path.", 'confirm.enroll'));
    await this.trusted('confirm.enroll', params, context, "set up deep-confirm's key again", 'device:deep-confirm', 'enroll');
    const why = await this.options.services.confirmer.enroll(this.options.services.now(), { words: "set up DeepBuild's confirmation key again on this Mac", subject: { handle: 'device:deep-confirm', revision: String((params.signature as { signed?: Obj }).signed?.device) } });
    if (why) throw new Refused(refusal('unconfirmed', '', `deep-confirm's key stays as it was: ${why}.`, 'confirm.enroll', true));
    return { device: this.options.services.devices.enclave()!.device };
  }

  /**
   * `deep install` (#351): installs the package in a folder once the OS confirms you, the prompt naming it, after the
   * CLI showed its source and permissions; with `trust_key`, the prompt names the publisher key its envelope names
   * too, and your confirmation trusts that key for the package first. A deep command inside an agent's process tree
   * acts as that session, and no agent installs a package. The installer's refusal comes back as the result.
   */
  async install(params: Obj, context: CallContext): Promise<Obj> {
    const from = params.from;
    if (typeof from !== 'string' || !isAbsolute(from)) throw new Refused(refusal('type', '/params/from', 'Give the package folder as an absolute path.', from));
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'An install counts from the CLI, once the OS confirms you.', 'extension.install'));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing was installed: this deep command runs inside agent session ${agent}'s process tree, and no agent installs a package. Install it from your own terminal.`, 'extension.install'));
    if (!existsSync(join(from, 'deepbuild.json')) && existsSync(join(from, 'pack.json'))) {
      if (!this.options.services.libraries) throw refuse('unavailable', '', 'The hub is not ready to install packs.', from, true);
      const pack = readPack(from);
      if (params.digest !== pack.digest) throw refuse('changed', '/params/digest', `${pack.ref} changed since its install plan was read.`, params.digest);
      const why = await this.options.services.confirmer.you(`install ${pack.ref} (${pack.digest}) from ${from}; its assets fetch only after a separate authority ask or rule`, { handle: `pack:${pack.ref}`, revision: pack.digest, process: context.peer });
      if (why) throw refuse('unconfirmed', '', `Nothing was installed: ${why}`, from, true);
      const dir = this.options.services.libraries.packs.stage(pack);
      const checked = await this.options.services.canvasSide.canvasCall({ call: 'install_pack', id: pack.id, dir });
      if (checked.outcome !== 'installed') return { status: 'refused', reason: JSON.stringify(checked.issues) };
      this.options.services.libraries.packs.admit(pack);
      return { status: 'installed', id: pack.id, version: pack.version, digest: pack.digest };
    }
    // Only for the prompt's words: the installer reads the manifest again, as data, and refuses what it must.
    const m = await readFile(join(from, 'deepbuild.json'), 'utf8').then((text) => JSON.parse(text) as { id?: unknown; version?: unknown; publisher_key?: unknown; sources?: { variant?: string; host?: string }[] })
      .catch(() => ({ id: undefined, version: undefined, publisher_key: undefined, sources: undefined }));
    // The hosts its library sources name (#1731), which this install grants, each at its source's own quota or under.
    const hosts = libraryHosts(m);
    const key = params.trust_key === true ? m.publisher_key : undefined;
    if (params.trust_key === true && (typeof key !== 'string' || typeof m.id !== 'string')) throw new Refused(refusal('required', '/params/trust_key', 'Only a signed package names a publisher key to trust.', from));
    const why = await this.options.services.confirmer.you(`${key ? `trust the publisher key ${String(key)} for ${String(m.id)}, and ` : ''}install ${String(m.id)}@${String(m.version)} from ${from}${hosts.length ? `, reaching ${hosts.join(', ')}` : ''}`, { handle: `package:${String(m.id)}`, revision: String(m.version), process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was installed: the OS didn't confirm you (${why}).`, from, true));
    if (!this.options.services.extensions) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', from, true));
    try {
      if (key) await this.options.services.extensions.trustKey(this.options.events.connection('cli'), String(m.id), String(key));
      const pkg = await this.options.services.extensions.install({ from, builtBy: null, ...(hosts.length ? { grant: { record: [], hosts: hosts.map((host) => ({ host, quota: LIBRARY_HOST_QUOTA })) } } : {}) });
      const installed = { status: 'installed', id: pkg.id, version: pkg.version, digest: pkg.digest };
      // Nothing loads before its conformance passes (#348): it runs now, and the package loads at once; its result,
      // kept for these bytes, lets each later start load it. One that fails stays installed, and the reason is shown.
      try {
        const checked = await this.options.services.extensions.check(pkg);
        const load = checked.passed ? await this.options.services.extensions.load(pkg) : { status: 'refused' as const, reason: `it failed conformance: ${checked.reasons.join('; ')}` };
        plantedReload(this.options.settings.plant);
        const panels = load.status === 'refused' ? undefined : await this.panelKits(pkg.id);
        return load.status === 'refused' ? { ...installed, not_loaded: load.reason } : panels ? { ...installed, not_loaded: panels } : installed;
      } catch (error) {
        return { ...installed, not_loaded: error instanceof Error ? error.message : String(error) };
      }
    } catch (error) {
      return { status: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Each view's panel held to panel@1 (#1454), its verdict kept for the app: what failed, in words, or undefined. */
  async panelKits(id: string, unrun = false): Promise<string | undefined> {
    const failed: string[] = [];
    for (const view of this.options.services.extensions!.installedViews().filter((v) => v.extension === id && (!unrun || v.kit === null))) {
      const { verdict, why } = await panelKit(view.folder);
      this.options.services.extensions!.keepKit(id, { slot: 'panel@1', fill: view.name, verdict });
      if (verdict !== 'PASS') failed.push(`${view.name} reads ${verdict} on panel@1: ${why}`);
    }
    return failed.length ? failed.join('; ') : undefined;
  }

  async runCommand(params: Obj): Promise<Obj> {
    const { action } = params;
    const view = this.options.services.extensions?.installedViews().find((v) => v.commands.some((c) => c.action === action));
    if (!view) throw new Refused(refusal('not_found', '/params/action', `No installed view runs ${String(action)}.`, action));
    return { ...(await this.options.services.extensions!.callAction({ action: String(action), target: { handle: `ext:${view.extension}`, version: view.version }, input: {}, caller: this.options.events.connection('app') })) };
  }

  /**
   * `deep off`, `deep on`, `deep hub stop`, `deep hub use` and `deep setup --undo` (#19): each takes effect only once
   * the OS confirms you, with a prompt naming the command. Run inside an agent's process tree it acts as that agent's
   * session, and no agent switches DeepBuild off; the peer check alone never makes one count.
   */
  /**
   * The OS confirming you for a press on the question card that wasn't hardware (#1454): one press, one prompt, naming
   * the option's words the app sends and the ask the hub reads, and never cached. The app signs its answer only after this.
   */
  async confirmCard(params: Obj): Promise<Obj> {
    const { ask: handle, reason } = params;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    if (typeof reason !== 'string' || !reason) throw new Refused(refusal('required', '/params/reason', "Give the words the OS's prompt shows.", reason));
    const [row] = (await this.options.services.record.raw("SELECT e.data AS data FROM events e WHERE e.id = ? AND e.kind = 'ask.created'", [handle.slice(4)])) as { data: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}.`, handle));
    const why = await this.options.services.confirmer.you(reason.slice(0, 200), { handle, revision: await this.options.control().revisionOf(handle, JSON.parse(row.data) as { pinned_to?: { ref?: string } }) });
    if (why) throw new Refused(refusal('unconfirmed', '/params/ask', `${handle} stays open: the OS didn't confirm you (${why}).`, handle, true));
    return { confirmed: handle };
  }

  async confirmCommand(params: Obj, context: CallContext): Promise<Obj> {
    const command = params.command;
    if (typeof command !== 'string' || !AUTHORITY.has(command)) throw new Refused(refusal('enum', '/params/command', `Name one of ${[...AUTHORITY].join(', ')}.`, command));
    const what = typeof params.detail === 'string' ? `${command} ${params.detail.slice(0, 200)}` : command;
    if (context.role !== 'cli') throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: from the app it counts only when a device you paired signs it; from your terminal, once the OS confirms you.`, command));
    // A deep command names its process so the peer check can read whose it is; a call that names none counts for
    // nothing, and asks the OS nothing.
    if (!context.peer) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the call names no process for the peer check; run the deep command itself.`, command));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/params/command', `${what} changed nothing: it runs inside agent session ${agent}'s process tree, so it acts as that session, and no agent changes what watches it. Run it from your own terminal.`, command));
    if (this.options.settings.plant === 'acts-on-peer-check') return { confirmed: command };
    const why = await this.options.services.confirmer.you(what, { handle: `command:${command}`, revision: what, process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '/params/command', `${what} changed nothing: the OS didn't confirm you (${why}). It takes effect only once the OS confirms you; run it again and confirm.`, command, true));
    return { confirmed: command };
  }

  /**
   * `deep guard add` (#304): installs the guard entries you wrote once the OS confirms you, the prompt naming them.
   * Each is checked first through deep-hook's check mode on its planted call and twin; a refusal comes back as the
   * result. No agent writes rules.json, so a deep command inside an agent's process tree adds nothing.
   */
  async addGuard(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A guard is added from the CLI, once the OS confirms you.', 'guard.add'));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing was added: this deep command runs inside agent session ${agent}'s process tree, and no agent changes your rules. Add it from your own terminal.`, 'guard.add'));
    const names = isObj(params.guards) && isObj(params.guards.entries) ? Object.keys(params.guards.entries) : [];
    const why = await this.options.services.confirmer.you(`add the guard ${names.length === 1 ? 'entry' : 'entries'} ${names.join(', ')} to your rules`, { handle: 'command:guard add', revision: names.join(','), process: context.peer });
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was added: the OS didn't confirm you (${why}).`, names.join(', '), true));
    return addGuards(this.options.services.root.dir, params.guards, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.settings.plant });
  }

  /**
   * deep_job (#1922): the job kinds and their qualified tools, or one run of a kind on a pinned tool, outside the hub's
   * process. It changes no document and needs no session; its result is a reading with a receipt, never a verdict.
   */
  async job(args: Obj, caller: string | undefined): Promise<Obj> {
    if (!this.options.services.jobKinds) throw refuse('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', 'deep_job', true);
    return args.op === 'list' ? this.options.services.jobKinds.list() : this.options.services.jobKinds.run(args, caller);
  }

  /** A pack's network authority is yours, never an agent's, and matches only that pack and license list. */
  async packRule(params: Obj, context: CallContext): Promise<Obj> {
    const { pack, licenses } = params;
    if (typeof pack !== 'string' || !Array.isArray(licenses) || !licenses.every((l) => typeof l === 'string' && l)) throw refuse('type', '/params', 'Name pack as owner/name and list its allowed license IDs.', params);
    const libraries = this.options.services.libraries;
    if (!libraries) throw refuse('unavailable', '', 'The hub is not ready.', pack, true);
    if (!libraries.packs.named(pack)) throw refuse('not_found', '/params/pack', `No pack ${pack} is installed; deep install <pack folder> installs one.`, pack);
    await this.asYou(context, 'pack.rule', `allow ${pack} to fetch assets under ${licenses.join(', ') || 'no license'}`, `pack:${pack}`, JSON.stringify(licenses));
    return libraries.packRule(pack, licenses as string[]);
  }

  /** `job.rule` (#1922): your standing rule for a paid tool, from your own terminal once the OS confirms you: the most a run may cost with no ask. */
  async jobRule(params: Obj, context: CallContext): Promise<Obj> {
    const { tool, usd } = params;
    if (typeof tool !== 'string' || !/^[a-z0-9][a-z0-9_-]*@\d+\.\d+\.\d+$/.test(tool)) throw new Refused(refusal('type', '/params/tool', 'Name the tool by name@version, as deep_job lists it.', tool));
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) throw new Refused(refusal('type', '/params/usd', 'Give usd, the most a run of the tool may cost with no ask, in US dollars.', usd));
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A paid tool\'s standing rule is set from your own terminal, once the OS confirms you.', 'job.rule'));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent sets a paid tool's rule. Run it from your own terminal.`, 'job.rule'));
    const what = `let ${tool} run at up to $${usd} a run with no ask`;
    const why = await this.options.services.confirmer.you(what, { handle: `job:${tool}`, revision: what });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, 'job.rule', true));
    if (!this.options.services.jobKinds) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', 'job.rule', true));
    return this.options.services.jobKinds.rule(tool, usd);
  }

  /** `library.on`, `library.off` and `library.rule` (#1731): yours alone, from your own terminal, once the OS confirms you. */
  async library(method: string, params: Obj, context: CallContext): Promise<Obj> {
    const { library, licenses } = params;
    if (typeof library !== 'string' || !library) throw new Refused(refusal('type', '/params/library', 'Name the library by its source name, as a search row\'s from names it.', library));
    if (method === 'library.rule' && (!Array.isArray(licenses) || !licenses.every((l) => typeof l === 'string' && l))) throw new Refused(refusal('type', '/params/licenses', 'List the licenses the rule allows, by SPDX ID.', licenses));
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A library is turned on or off, and its rule set, from your own terminal, once the OS confirms you.', method));
    const agent = await this.options.state().agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing changed: this deep command runs inside agent session ${agent}'s process tree, and no agent changes a library. Run it from your own terminal.`, method));
    const libraries = this.options.services.libraries;
    if (!libraries) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', method, true));
    const unchangeable = libraries.unchangeable(library, method === 'library.off');
    if (unchangeable) throw new Refused(refusal('not_found', '/params/library', `${unchangeable}.`, library));
    const what = method === 'library.rule' ? `let ${library} fetch under ${(licenses as string[]).join(', ') || 'no license'} with no ask` : `turn ${library} ${method === 'library.on' ? 'on' : 'off'}`;
    const why = await this.options.services.confirmer.you(what, { handle: `library:${library}`, revision: what });
    if (why) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the OS didn't confirm you (${why}).`, method, true));
    try {
      return method === 'library.rule' ? { ...libraries.rule(library, licenses as string[]) } : { ...libraries.turn(library, method === 'library.on') };
    } catch (e) {
      if (e instanceof LibraryRefused) throw new Refused(refusal('not_found', '/params/library', `${e.message}.`, library));
      throw e;
    }
  }

}
