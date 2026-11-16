#!/usr/bin/perl
# The stand-in `claude` of #1349's acceptance tests (README: Stand-ins). The stand-in installer copies it to where
# Claude Code's own installer puts its program, ~/.local/bin/claude. It stands for Claude Code and its model, the
# boundary these tests don't own, and decides nothing about DeepBuild:
#
# - `--version` prints the newest version the shipped facts cover.
# - `auth status`, the sign-in probe the facts name: signed in while __STATE__/signed-in exists (stdout JSON with
#   loggedIn true, exit 0), else loggedIn false and exit 1. Its output carries the probe's canary, which DeepBuild
#   must never keep.
# - `auth login`, the agent's own sign-in command (adapters/sign-in.json): it notes that it started, prints the
#   sign-in canary, and returns at once, as the agent's page coming back does. It signs nobody in: the test signs in
#   as the person does, by writing __STATE__/signed-in.
# - A headless run (`-p`/`--print`, the prompt on stdin) is a job on the runner. It sends its prompt to the model,
#   the test's server, reached as api.anthropic.com:443 through the job's HTTPS_PROXY (the runner's forwarder), and
#   prints what comes back in Claude Code's stream-json: the answer as the final result, or Claude Code's API error
#   `authentication_failed` when the model refuses the sign-in. It writes nothing, so it runs under the runner's
#   sandbox; the model's server is where the test sees what reached the agent.
# - Any other first word (a subcommand such as `plugin` or `mcp`) is noted and exits 0.
# - Anything else is a session: it waits, doing nothing, until it is stopped.
#
# Perl, so it runs on a Mac with no developer tools and under the runner's sandbox.
use strict;
use warnings;
use Cwd ();
use IO::Socket::INET;
use JSON::PP;
use Time::HiRes qw(time);

my $VERSION = '__VERSION__';
my $STATE = '__STATE__';
my $PROBE = '__PROBE__';
my $SIGNIN = '__SIGNIN__';
my $MODEL = 'claude-haiku-5-5';
my $json = JSON::PP->new->canonical(1);
$| = 1;

# Best effort: a sandboxed job may not write here, and a job never needs to.
sub note { if (open(my $f, '>>', "$STATE/calls.log")) { print $f join(' ', @_), "\n"; close $f; } }

if (grep { $_ eq '--version' || $_ eq '-v' } @ARGV) { print "$VERSION (Claude Code)\n"; exit 0; }
if (@ARGV >= 2 && $ARGV[0] eq 'auth' && $ARGV[1] eq 'status') {
  note('auth status');
  my $in = -e "$STATE/signed-in" ? 1 : 0;
  print $json->encode({ loggedIn => $in ? JSON::PP::true : JSON::PP::false, authMethod => $in ? 'claude.ai' : 'none', apiProvider => 'firstParty',
    probeTrace => $PROBE }), "\n";
  exit($in ? 0 : 1);
}
if (@ARGV >= 2 && $ARGV[0] eq 'auth' && $ARGV[1] eq 'login') {
  note('auth login');
  print "Opening your browser to sign in to Claude Code. Session $SIGNIN\n";
  exit 0;
}
if (!grep { $_ eq '-p' || $_ eq '--print' } @ARGV) {
  if (@ARGV && $ARGV[0] !~ /^-/) { note('other', @ARGV); exit 0; }
  note('session');
  exec('/bin/sleep', '3600');
  exit 0;
}

my $format = 'text';
for (my $i = 0; $i < @ARGV; $i++) {
  if ($ARGV[$i] eq '--output-format') { $format = $ARGV[$i + 1] // 'text'; }
  elsif ($ARGV[$i] =~ /^--output-format=(.*)$/) { $format = $1; }
}
my $stdin = -t STDIN ? '' : do { local $/; <STDIN> // '' };
my $prompt = join("\n", $stdin, grep { $_ ne '-' } @ARGV);
my $session = sprintf('%08x-0000-4000-8000-%012x', $$, int(time * 1000) % (16 ** 12));

# The model: CONNECT through the job's proxy, one JSON line out, one back.
my $reply;
{
  my $proxy = $ENV{HTTPS_PROXY} // $ENV{https_proxy} // '';
  my ($host, $port) = $proxy =~ m{^http://([^/:]+):(\d+)/?$};
  if (!$host) { print STDERR "stand-in claude: no HTTPS_PROXY to reach the model through\n"; exit 1; }
  my $s = IO::Socket::INET->new(PeerAddr => $host, PeerPort => $port, Proto => 'tcp', Timeout => 30);
  if (!$s) { print STDERR "stand-in claude: the model can't be reached: $!\n"; exit 1; }
  syswrite($s, "CONNECT api.anthropic.com:443 HTTP/1.1\r\nHost: api.anthropic.com:443\r\n\r\n");
  my $head = '';
  while ($head !~ /\r\n\r\n/) { my $n = sysread($s, my $c, 1); last unless $n; $head .= $c; }
  if ($head !~ m{^HTTP/1\.[01] 200}) { print STDERR "stand-in claude: the proxy refused the model: $head\n"; exit 1; }
  syswrite($s, $json->encode({ prompt => $prompt }) . "\n");
  my $line = '';
  while ($line !~ /\n/) { my $n = sysread($s, my $c, 65536); last unless $n; $line .= $c; }
  close $s;
  $reply = eval { $json->decode((split /\n/, $line)[0] // '') } // {};
}

my $usage = { input_tokens => 40, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 30 };
my $init = { type => 'system', subtype => 'init', cwd => Cwd::getcwd(), session_id => $session, model => $MODEL, tools => [], mcp_servers => [],
  permissionMode => 'dontAsk', apiKeySource => 'none', claude_code_version => $VERSION, uuid => "$session-1" };

if (($reply->{error} // '') eq 'authentication_failed') {
  my $text = 'Invalid API key · Please run /login';
  if ($format eq 'stream-json') {
    print $json->encode($init), "\n";
    print $json->encode({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => "$session-2", isApiErrorMessage => JSON::PP::true,
      error => 'authentication_failed', message => { id => "msg_$session", type => 'message', role => 'assistant', model => '<synthetic>',
      content => [{ type => 'text', text => $text }], stop_reason => 'stop_sequence', usage => { input_tokens => 0, output_tokens => 0 } } }), "\n";
  }
  my $result = { type => 'result', subtype => 'success', is_error => JSON::PP::true, duration_ms => 300, duration_api_ms => 0, num_turns => 1, result => $text,
    session_id => $session, total_cost_usd => 0, usage => { input_tokens => 0, output_tokens => 0 }, permission_denials => [], uuid => "$session-3" };
  if ($format eq 'stream-json' || $format eq 'json') { print $json->encode($result), "\n"; } else { print "$text\n"; }
  exit 1;
}
if (!defined $reply->{answer}) {
  print STDERR "stand-in claude: the model gave no answer: ", ($reply->{error} // 'nothing'), "\n";
  exit 1;
}
my $text = ref $reply->{answer} ? $json->encode($reply->{answer}) : $reply->{answer};
if ($format eq 'stream-json') {
  print $json->encode($init), "\n";
  print $json->encode({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => "$session-2", message => {
    id => "msg_$session", type => 'message', role => 'assistant', model => $MODEL, content => [{ type => 'text', text => $text }], stop_reason => 'end_turn', usage => $usage } }), "\n";
}
my $result = { type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 900, duration_api_ms => 700, num_turns => 1, result => $text,
  session_id => $session, total_cost_usd => 0, usage => $usage, modelUsage => { $MODEL => { inputTokens => 40, outputTokens => 30, costUSD => 0 } },
  permission_denials => [], uuid => "$session-3" };
if ($format eq 'stream-json' || $format eq 'json') { print $json->encode($result), "\n"; } else { print "$text\n"; }
exit 0;
