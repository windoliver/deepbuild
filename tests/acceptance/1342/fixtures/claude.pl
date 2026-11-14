#!/usr/bin/perl
# The played `claude` of #1342's acceptance tests (README: What is real, what is played), installed by helpers.ts as
# `claude` first on the test home's login PATH. It stands for Claude Code and its model, the boundary these tests don't
# own, and decides nothing about DeepBuild:
#
# - `--version` prints the newest version the shipped facts cover; `auth status` says it is signed in.
# - A headless run (`-p` or `--print`, the prompt on stdin or in argv) is a job on the runner. It answers the research
#   job: the first entry of research.json, beside this file, whose `match` is in its prompt, is its answer, printed as
#   the final result text (`research.answer`, README: The contract). An entry with a `gate` waits until a file of that
#   name is beside this file, so a test can read what shows while the job runs. Each held step's `due_in_s` becomes
#   `due`, an ISO 8601 time that many seconds after the answer. A job whose prompt matches no entry fails, naming that.
#   It prints stream-json shaped as Claude Code's own (system/init, an assistant message, a result event), or one JSON
#   result for `--output-format json`, or the text for any other.
# - Anything else is a session: it is #1332's played agent (../../1332/fixtures/agent.mjs, installed beside the test's
#   agents folder), run with the same argv.
#
# Perl, so a job runs under the runner's sandbox with the system's own runtime.
use strict;
use warnings;
use Cwd qw(abs_path);
use File::Basename qw(dirname);
use JSON::PP;
use POSIX qw(strftime);
use Time::HiRes qw(sleep time);

my $VERSION = '__VERSION__';
my $NODE = '__NODE__';
my $SESSION = '__SESSION__';
my $MODEL = 'claude-haiku-5-5';
my $GATE_WAIT = 900;
my $DIR = dirname(abs_path($0) // $0);
my $json = JSON::PP->new->canonical(1);
$| = 1;

if (grep { $_ eq '--version' || $_ eq '-v' } @ARGV) { print "$VERSION (Claude Code)\n"; exit 0; }
if (@ARGV >= 2 && $ARGV[0] eq 'auth' && $ARGV[1] eq 'status') {
  print $json->encode({ loggedIn => JSON::PP::true, authMethod => 'claude.ai', apiProvider => 'firstParty', subscriptionType => 'max' }), "\n";
  exit 0;
}
if (!grep { $_ eq '-p' || $_ eq '--print' } @ARGV) {
  exec($NODE, $SESSION, @ARGV);
  die "played claude: the session player $SESSION did not start: $!\n";
}

my $format = 'text';
for (my $i = 0; $i < @ARGV; $i++) {
  if ($ARGV[$i] eq '--output-format') { $format = $ARGV[$i + 1] // 'text'; }
  elsif ($ARGV[$i] =~ /^--output-format=(.*)$/) { $format = $1; }
}
my $stdin = -t STDIN ? '' : do { local $/; <STDIN> // '' };
my $prompt = join("\n", $stdin, @ARGV);
my $session = sprintf('%08x-0000-4000-8000-%012x', $$, int(time * 1000) % (16 ** 12));

my $config = {};
if (open(my $f, '<', "$DIR/research.json")) { local $/; $config = $json->decode(scalar <$f>); close $f; }
my ($entry) = grep { index($prompt, $_->{match}) >= 0 } @{ $config->{answers} // [] };
if (!$entry) {
  print STDERR "played claude: no answer in $DIR/research.json matches this job's prompt\n";
  exit 1;
}
if (my $gate = $entry->{gate}) {
  for (my $end = time + $GATE_WAIT; !-e "$DIR/$gate" && time < $end;) { sleep(0.2); }
}
my $answer = $entry->{answer};
for my $held (@{ $answer->{held} // [] }) {
  my $in = delete $held->{due_in_s};
  $held->{due} = strftime('%Y-%m-%dT%H:%M:%SZ', gmtime(time + $in)) if defined $in;
}
my $text = $json->encode($answer);

if ($format eq 'stream-json') {
  print $json->encode({ type => 'system', subtype => 'init', cwd => Cwd::getcwd(), session_id => $session, model => $MODEL, tools => [], mcp_servers => [],
    permissionMode => 'dontAsk', apiKeySource => 'none', claude_code_version => $VERSION, uuid => "$session-1" }), "\n";
  print $json->encode({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => "$session-2", message => {
    id => "msg_$session", type => 'message', role => 'assistant', model => $MODEL, content => [{ type => 'text', text => $text }], stop_reason => 'end_turn',
    usage => { input_tokens => 40, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 30 } } }), "\n";
}
my $result = { type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 900, duration_api_ms => 700, num_turns => 1, result => $text,
  session_id => $session, total_cost_usd => 0, usage => { input_tokens => 40, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 30 },
  modelUsage => { $MODEL => { inputTokens => 40, outputTokens => 30, costUSD => 0 } }, permission_denials => [], uuid => "$session-3" };
if ($format eq 'stream-json' || $format eq 'json') { print $json->encode($result), "\n"; }
else { print "$text\n"; }
exit 0;
