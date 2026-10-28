// The wrong programs these criteria name or their Scope rules out (README, Criteria). Hub-side ones are planted
// programs the hub selects with DEEP_HUB_PLANT (packages/hub/src/plant.ts lists them; the implementer adds each), so
// a scenario that passes on the real hub fails on its plant for the reason named here. The adapter's is planted
// around the real Claude Code adapter here: the real reply with one part wrong.

import { shipped } from '../../../../packages/adapters/src/index.ts';
import { CANCEL, CLOUD, DEPENDENCY, HUB_DOWN, MODE_GUARD, TYPED, WEEK } from './helpers.ts';
import { cancelledPrompt, cloudResource, hubStopped, modeAndGuard, newDependency, typedApproval, weekOfAnswers, type Reply, type Run } from './scenarios.ts';

/** The real Claude Code adapter's permission reply, from the shipped registry. */
export function claudeReply(): Reply {
  const adapter = shipped().get('claude');
  if (!adapter.permissionReply) throw Error(`${CANCEL} the Claude Code adapter must answer permission requests (permissionReply)`);
  return adapter.permissionReply.bind(adapter);
}
/** #23.02482c32: the adapter that answers a cancelled ask deny, as anything that isn't an allow. */
export const cancelAsDenyAdapter = (): Reply => {
  const real = claudeReply();
  return (answer, request) => real((answer.decision as string) === 'cancel' ? { ...answer, decision: 'deny' } : answer, request);
};

export interface HubPlant { plant: string; criterion: string; does: string; scenario: (o: Run) => Promise<void>; named: RegExp }
/** Each hub plant, the scenario it must fail, and what that failure names. */
export const HUB_PLANTS: HubPlant[] = [
  {
    plant: 'permission-always-allow', criterion: WEEK, scenario: weekOfAnswers,
    does: "answers a permission prompt allow with the agent's own \"always allow\" option: the prompt's permission_suggestions, a rule for the local settings file",
    named: /answer for that call or that session only; it picks the agent's option that writes a lasting rule into its own settings: updatedPermissions addRules for localSettings/,
  },
  {
    plant: 'cancel-as-deny', criterion: CANCEL, scenario: cancelledPrompt,
    does: 'answers the prompt of a cancelled ask deny',
    named: /gets deny; a cancelled ask gets cancel, never deny/,
  },
  {
    plant: 'typed-saves-decision', criterion: TYPED, scenario: typedApproval,
    does: 'saves an approval typed in the session as a decision for the open ask it approves, with no click',
    named: /must not become a saved decision before your click: decision:[0-9A-Za-z]+ saved from it|one click must save exactly one decision, from ask:[0-9A-Za-z]+: 2 saved/,
  },
  {
    plant: 'decision-over-mode', criterion: MODE_GUARD, scenario: modeAndGuard,
    does: "answers a call its standing rule covers with Claude Code's explicit allow whatever the session's permission mode",
    named: /allowed `aws kms create-key[^`]*` in a session whose permission mode, dontAsk, denies it/,
  },
  {
    plant: 'decision-before-guard', criterion: MODE_GUARD, scenario: modeAndGuard,
    does: "consults saved decisions before the guards: a call its standing rule covers is allowed though a guard in block mode matched it",
    named: /allowed `aws kms create-key[^`]*--bypass-policy-lockout-safety-check`, which your guard no-kms-lockout-bypass denies/,
  },
  {
    plant: 'rule-without-reason', criterion: DEPENDENCY, scenario: newDependency,
    does: "answers a call by your standing rule but tells the agent nothing of why",
    named: /the agent must see the reason `npm install is-odd` was answered: what it reads must cite your standing rule decision:[0-9A-Za-z]+/,
  },
  {
    plant: 'rule-without-reason', criterion: CLOUD, scenario: cloudResource,
    does: "answers a call by your standing rule but tells the agent nothing of why",
    named: /the agent must see the reason `aws kms create-key --profile shop-prod[^`]*` was answered: what it reads must cite your standing rule decision:[0-9A-Za-z]+/,
  },
  {
    plant: 'copies-no-standing-rules', criterion: HUB_DOWN, scenario: hubStopped,
    does: 'never copies a standing rule into rules.json',
    named: /with the hub stopped, `aws kms create-key --profile shop-prod[^`]*` in account 111122223333, which your standing rule covers, must be allowed; it was denied/,
  },
];
