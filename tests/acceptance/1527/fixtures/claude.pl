#!/usr/bin/perl
# The played `claude` of #1527's acceptance tests (README: What is real, what is played), installed by helpers.ts over
# #1342's played claude, as `claude` first on the test home's login PATH. It stands for Claude Code and its model, the
# boundary these tests don't own, and decides nothing about DeepBuild:
#
# - `--version` prints the newest version the shipped facts cover; `auth status` says it is signed in.
# - A headless run (`-p` or `--print`, the prompt on stdin or in argv) whose prompt holds "DeepBuild research job" is the
#   research job: the first entry of research.json (beside this file, #1342's format) whose `match` is in its prompt is
#   its answer, printed as the final result text. It costs nothing.
# - Any other headless run is a work turn. One whose prompt holds "dry run" is the card's dry run: the first entry of
#   work.json's `dry` whose `match` is in its prompt. Any other is a run's model turn: the first entry of work.json's
#   `turns` whose `match` is in its prompt. The entry's `files` (a relative path to its text) are written into the
#   folder it runs in, and its result reports `cost_usd` as `total_cost_usd` (left out when the entry's cost is null).
#   A run whose prompt matches no entry fails, naming that.
# - Anything else is a session: the entry of work.json's `turns` its argv matches has its files written into its folder,
#   then it is #1332's played agent (installed beside the test's agents folder), run with the same argv.
#
# The test rewrites work.json between fires, so what a turn does and costs is fixed by the test, never by state kept
# here. Perl, so a job runs under the runner's sandbox with the system's own runtime.
use strict;
use warnings;
use Cwd qw(abs_path getcwd);
use File::Basename qw(dirname);
use File::Path qw(make_path);
use JSON::PP;
use Time::HiRes qw(time);

my $VERSION = '__VERSION__';
my $NODE = '__NODE__';
my $SESSION = '__SESSION__';
my $MODEL = 'claude-haiku-5-5';
my $DIR = dirname(abs_path($0) // $0);
my $json = JSON::PP->new->canonical(1);
$| = 1;

if (grep { $_ eq '--version' || $_ eq '-v' } @ARGV) { print "$VERSION (Claude Code)\n"; exit 0; }
if (@ARGV >= 2 && $ARGV[0] eq 'auth' && $ARGV[1] eq 'status') {
  print $json->encode({ loggedIn => JSON::PP::true, authMethod => 'claude.ai', apiProvider => 'firstParty', subscriptionType => 'max' }), "\n";
  exit 0;
}

sub config {
  my ($name) = @_;
  open(my $f, '<', "$DIR/$name") or return {};
  local $/;
  my $c = $json->decode(scalar <$f>);
  close $f;
  return $c;
}
sub pick {
  my ($list, $text) = @_;
  my ($entry) = grep { index($text, $_->{match} // '') >= 0 } @{ $list // [] };
  return $entry;
}
sub write_files {
  my ($files) = @_;
  for my $path (sort keys %{ $files // {} }) {
    next if $path =~ m{(^|/)\.\.(/|$)} || $path =~ m{^/};
    my $to = getcwd() . "/$path";
    make_path(dirname($to));
    open(my $out, '>', $to) or die "played claude: can't write $to: $!\n";
    print $out $files->{$path};
    close $out;
    chmod(0755, $to) if $path =~ /\.sh$/;
  }
}

if (!grep { $_ eq '-p' || $_ eq '--print' } @ARGV) {
  my $work = config('work.json');
  my $entry = pick($work->{turns}, join("\n", @ARGV));
  write_files($entry->{files}) if $entry;
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

my ($text, $cost);
if (index($prompt, 'DeepBuild research job') >= 0) {
  my $entry = pick(config('research.json')->{answers}, $prompt);
  if (!$entry) { print STDERR "played claude: no answer in $DIR/research.json matches this research job's prompt\n"; exit 1; }
  $text = $json->encode($entry->{answer});
  $cost = 0;
} else {
  my $work = config('work.json');
  my $dry = $prompt =~ /dry run/i;
  my $entry = pick($dry ? $work->{dry} : $work->{turns}, $prompt);
  if (!$entry) { print STDERR "played claude: no " . ($dry ? 'dry run' : 'turn') . " in $DIR/work.json matches this job's prompt\n"; exit 1; }
  write_files($entry->{files});
  $text = $entry->{says} // 'Done.';
  $cost = $entry->{cost_usd};
}

if ($format eq 'stream-json') {
  print $json->encode({ type => 'system', subtype => 'init', cwd => getcwd(), session_id => $session, model => $MODEL, tools => [], mcp_servers => [],
    permissionMode => 'dontAsk', apiKeySource => 'none', claude_code_version => $VERSION, uuid => "$session-1" }), "\n";
  print $json->encode({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => "$session-2", message => {
    id => "msg_$session", type => 'message', role => 'assistant', model => $MODEL, content => [{ type => 'text', text => $text }], stop_reason => 'end_turn',
    usage => { input_tokens => 40, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 30 } } }), "\n";
}
my $result = { type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 900, duration_api_ms => 700, num_turns => 1, result => $text,
  session_id => $session, usage => { input_tokens => 40, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 30 },
  modelUsage => { $MODEL => { inputTokens => 40, outputTokens => 30, (defined $cost ? (costUSD => $cost) : ()) } }, permission_denials => [], uuid => "$session-3" };
$result->{total_cost_usd} = $cost if defined $cost;
if ($format eq 'stream-json' || $format eq 'json') { print $json->encode($result), "\n"; }
else { print "$text\n"; }
exit 0;
