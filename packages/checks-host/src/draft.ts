// What done means for a machine, drafted after a probe (#1943; design: Done, for a machine): it fits the machine you
// have. Each service the work sets up is enabled and survives a restart; nothing listens beyond what listened at the
// probe and what the work asks for; the disk keeps what was free at the probe less what the work takes. A reboot is
// never a check: done that needs one is a question, and the reboot runs only with your yes.
import type { Listener, MachineAsk, MachineDraft, MachineSpec, Probe } from './types.js';

export function draftMachine(probe: Probe, ask: MachineAsk): MachineDraft {
  const { host } = probe;
  const base = { kind: 'machine' as const, runner: 'ssh' as const, inputs: [] as string[], depth: 'integration', oracle: 'code' as const, contract: null, host };
  const listening = new Map<string, Listener>();
  for (const l of [...probe.facts.listening.value, ...ask.listening]) listening.set(`${l.address}:${l.port}`, { address: l.address, port: l.port });
  const machine: MachineSpec = { ...base, listening: [...listening.values()] };
  const questions: string[] = [];
  const disk = probe.facts.disk.value[0];
  if (disk && disk.free_bytes >= ask.disk_bytes) machine.disk = { path: disk.path, free_bytes: disk.free_bytes - ask.disk_bytes };
  else if (disk) questions.push(`${host} has ${disk.free_bytes} bytes free at ${disk.path}, less than the ${ask.disk_bytes} the work takes. Free space there, or set it up on another host?`);
  if (ask.reboot) questions.push(`Done on ${host} includes coming back after a reboot. A reboot runs only with your yes: reboot ${host} to check it?`);
  return { checks: [...ask.services.map((service): MachineSpec => ({ ...base, service })), machine], questions };
}
