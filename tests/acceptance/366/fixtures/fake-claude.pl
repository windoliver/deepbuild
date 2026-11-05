#!/usr/bin/perl
# A fake `claude` for the #366 acceptance tests (README, The fake CLI), cut down from #159's: the agent CLI is the one
# boundary DeepBuild doesn't own, so the runner's jobs launch this instead of a model. It answers what the runner asks
# of Claude Code (`--version`, `auth status`, and a headless run: `-p --output-format stream-json --verbose`, the
# prompt on stdin), refuses to start inside another Claude Code session (CLAUDECODE=1), and prints stream-json shaped
# as Claude Code's own: system/init (session_id, model, apiKeySource, claude_code_version), assistant messages and a
# result (subtype, is_error, result, session_id, total_cost_usd, usage, modelUsage, permission_denials).
#
# What it does comes from `@` lines in its prompt, so the plug-in that writes the job's prompt drives it:
#   @read <path>     try to read the file; whatever it read is added to the answer's value
#   @answer <json>   the final result's text: <json>, an object { "value": ..., "cites": [handle, ...] }
#   @fail <error>    an API error entry (is_api_error_message, error: <error>, e.g. rate_limit) and an error result
# Each line it acts on is reported as an assistant text `fake:<JSON>`; the first is its start, with the stdin it read.
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(encode_base64);
use Cwd qw(getcwd abs_path);

my $VERSION = '__VERSION__';
my $json = JSON::PP->new->canonical(1);
$| = 1;
sub out { print STDOUT $json->encode($_[0]), "\n"; }
sub uuid {
  open(my $r, '<', '/dev/urandom') or return sprintf('%08x-0000-4000-8000-%012x', $$, time);
  read($r, my $b, 16); close $r;
  my $h = unpack('H*', $b);
  return join('-', substr($h, 0, 8), substr($h, 8, 4), '4' . substr($h, 13, 3), '8' . substr($h, 17, 3), substr($h, 20, 12));
}

my @argv = @ARGV;
if (grep { $_ eq '--version' || $_ eq '-v' } @argv) { print "$VERSION (Claude Code)\n"; exit 0; }
if (@argv >= 2 && $argv[0] eq 'auth' && $argv[1] eq 'status') {
  out({ loggedIn => JSON::PP::true, authMethod => 'claude.ai', apiProvider => 'firstParty', subscriptionType => 'max' });
  exit 0;
}
if (($ENV{CLAUDECODE} // '') eq '1') { print STDERR "Error: Claude Code cannot be launched inside another Claude Code session.\n"; exit 1; }
my %VALUE = map { $_ => 1 } qw(--output-format --input-format --model --mcp-config --setting-sources --permission-mode --allowedTools
  --allowed-tools --disallowedTools --disallowed-tools --tools --settings --add-dir --max-turns --append-system-prompt --system-prompt --agents);
my (%flag, @positional);
for (my $i = 0; $i < @argv; $i++) {
  my $a = $argv[$i];
  if ($a =~ /^(--[^=]+)=(.*)$/s) { $flag{$1} = $2; next; }
  if ($VALUE{$a}) { $flag{$a} = $argv[++$i] // ''; next; }
  if ($a =~ /^-/) { $flag{$a} = 1; next; }
  push @positional, $a;
}
unless ($flag{'-p'} || $flag{'--print'}) { print STDERR "fake claude: only headless runs (-p) are modelled\n"; exit 1; }
if (($flag{'--output-format'} // 'text') eq 'stream-json' && !$flag{'--verbose'}) {
  print STDERR "Error: When using --print, --output-format=stream-json requires --verbose\n";
  exit 1;
}
my $prompt = '';
if (@positional) { $prompt = join(' ', @positional); } else { local $/; $prompt = <STDIN> // ''; }

my $session = uuid();
my $model = $flag{'--model'} // 'claude-haiku-4-5';
out({ type => 'system', subtype => 'init', cwd => getcwd(), session_id => $session, model => $model, tools => ['Read', 'Grep', 'Glob'],
  mcp_servers => [], permissionMode => ($flag{'--permission-mode'} // 'default'), apiKeySource => (defined $ENV{ANTHROPIC_API_KEY} ? 'ANTHROPIC_API_KEY' : 'none'),
  claude_code_version => $VERSION, uuid => uuid() });

my %usage = (input_tokens => 0, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 0);
sub say_text {
  my ($text, %extra) = @_;
  my %u = (input_tokens => 12, cache_creation_input_tokens => 3, cache_read_input_tokens => 100, output_tokens => 7);
  $usage{$_} += $u{$_} for keys %u;
  out({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => uuid(), %extra,
    message => { id => 'msg_' . substr(uuid(), 0, 8), type => 'message', role => 'assistant', model => $model,
      content => [{ type => 'text', text => $text }], stop_reason => undef, usage => \%u } });
}
sub report { say_text('fake:' . $json->encode($_[0])); }
report({ cmd => 'start', argv0 => (abs_path($0) // $0), version => $VERSION, pid => $$, argv => \@argv, stdin => encode_base64($prompt, '') });

my ($answer, $fail, @found);
for my $line (split /\n/, $prompt) {
  next unless $line =~ /^\@([a-z]+)\s*(.*?)\s*$/;
  my ($c, $arg) = ($1, $2);
  if ($c eq 'answer') { $answer = $arg; }
  elsif ($c eq 'fail') { $fail = $arg || 'rate_limit'; }
  elsif ($c eq 'read') {
    my $text;
    if (open(my $f, '<', $arg)) { local $/; $text = <$f>; close $f; }
    push @found, $text if defined $text;
    report({ cmd => 'read', path => $arg, ok => (defined $text ? JSON::PP::true : JSON::PP::false), errno => (defined $text ? '' : "$!") });
  }
}

my %result = (type => 'result', duration_ms => 900, duration_api_ms => 700, num_turns => 1, session_id => $session,
  total_cost_usd => 0.0042, usage => { %usage, service_tier => 'standard' }, permission_denials => [], uuid => uuid(),
  modelUsage => { $model => { inputTokens => $usage{input_tokens}, outputTokens => $usage{output_tokens}, costUSD => 0.0042 } });
if (defined $fail) {
  my $text = 'API Error: Request rejected (429) · Rate limit reached';
  say_text($text, is_api_error_message => JSON::PP::true, isApiErrorMessage => JSON::PP::true, error => $fail);
  out({ %result, subtype => 'success', is_error => JSON::PP::true, result => $text });
  exit 0;
}
my $text = defined $answer ? $answer : '{"value":"fake done","cites":[]}';
if (@found) {
  my $v = eval { decode_json($text) };
  if (ref $v eq 'HASH') { $v->{value} = join(' | ', (defined $v->{value} ? $v->{value} : ''), @found); $text = $json->encode($v); }
  else { $text = join(' | ', $text, @found); }
}
say_text($text);
out({ %result, subtype => 'success', is_error => JSON::PP::false, result => $text });
exit 0;
