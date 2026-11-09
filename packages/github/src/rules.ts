// The rules the forge needs so that only the gate turns a commit green (#1325), as bodies GitHub's REST
// "create a repository ruleset" call takes. DeepBuild prints them and never applies them (#46): you, or the link
// that sets a repo up, put them on. The default branch requires `deepbuild/verdict` from the gate's app, and only a
// person with admin, through the forge's own bypass, updates it: so no agent's credential merges or pushes it. Only
// such a person makes, moves or deletes a `deep/approved/` tag.
type Obj = Record<string, unknown>;

/** The commit status context the gate's verdict is delivered under, and the one the default branch requires. */
export const CONTEXT = 'deepbuild/verdict';
/** GitHub's role ID for a repo's admins: the person who lands by hand bypasses through it. */
const ADMIN = { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' };

/** The rulesets, by the apps' IDs. The plants are wrong programs: a rule that reads the context alone, and rules that let the agents' app merge, push the default branch or push an approval tag. */
export function rulesets(o: { gate: number; agents: number | null; plant?: string }): Obj[] {
  const agents = (mode: string): Obj[] => (o.agents === null ? [] : [{ actor_id: o.agents, actor_type: 'Integration', bypass_mode: mode }]);
  const check: Obj = o.plant === 'rule-reads-context-alone' ? { context: CONTEXT } : { context: CONTEXT, integration_id: o.gate };
  return [
    {
      name: 'deepbuild: default branch', target: 'branch', enforcement: 'active',
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      bypass_actors: [ADMIN, ...(o.plant === 'agent-credential-merges' ? agents('pull_request') : o.plant === 'agent-credential-pushes-default-branch' ? agents('always') : [])],
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        { type: 'update', parameters: { update_allows_fetch_and_merge: false } },
        { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, do_not_enforce_on_create: false, required_status_checks: [check] } },
      ],
    },
    {
      name: 'deepbuild: approval tags', target: 'tag', enforcement: 'active',
      conditions: { ref_name: { include: ['refs/tags/deep/approved/**'], exclude: [] } },
      bypass_actors: [ADMIN, ...(o.plant === 'agent-credential-pushes-approved-tags' ? agents('always') : [])],
      rules: [{ type: 'creation' }, { type: 'update', parameters: { update_allows_fetch_and_merge: false } }, { type: 'deletion' }],
    },
  ];
}
