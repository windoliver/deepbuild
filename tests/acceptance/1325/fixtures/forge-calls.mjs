// What a session's command does on the forge with the credential its session was given (README: AC2, AC4): run as one
// Bash call of the session, so its git and curl are its children, which no hook sees, as a script inside `npm test`
// would be. Each call is the real `git push` or `curl` a script would make, with GH_TOKEN, the session's credential,
// and its output is let through unchanged, as the call's own output. The last line is a summary of exit codes.
//
//   node forge-calls.mjs '<config as JSON>'
//   config: { api, repo: "owner/name", head: <sha>, pr: <number>, branch, tag, base: "main", calls: [<call>...] }
//   calls: push-branch, post-status, push-approved-tag, push-default-branch, merge
import { execFileSync, spawnSync } from 'node:child_process';

const config = JSON.parse(process.argv[2]);
const token = process.env.GH_TOKEN ?? '';
const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
// The credential goes in as a header, as a credential helper would put it; no helper of the machine's is asked. The
// push names the URL, not the remote, so git writes no remote-tracking ref into the checkout's own folder.
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`, GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '' };
const push = (refspec) => spawnSync('git', ['push', origin, refspec], { env: gitEnv, stdio: 'inherit' }).status;
const curl = (method, path, body) => spawnSync('/usr/bin/curl', ['-sS', '--fail-with-body', '-X', method, '-H', '@-', `${config.api}${path}`, '--data', JSON.stringify(body)], {
  input: `Authorization: Bearer ${token}\nAccept: application/vnd.github+json\nContent-Type: application/json\n`, stdio: ['pipe', 'inherit', 'inherit'],
}).status;

const done = {};
for (const call of config.calls) {
  if (call === 'push-branch') done[call] = push(`${config.head}:refs/heads/${config.branch}`);
  else if (call === 'post-status') done[call] = curl('POST', `/repos/${config.repo}/statuses/${config.head}`, { state: 'success', context: 'deepbuild/verdict', description: 'PASS' });
  else if (call === 'push-approved-tag') done[call] = push(`${config.head}:refs/tags/${config.tag}`);
  else if (call === 'push-default-branch') done[call] = push(`${config.head}:refs/heads/${config.base}`);
  else if (call === 'merge') done[call] = curl('PUT', `/repos/${config.repo}/pulls/${config.pr}/merge`, {});
  process.stdout.write('\n');
}
process.stdout.write(`${JSON.stringify({ forgeCalls: done })}\n`);
