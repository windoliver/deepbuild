#!/usr/bin/perl
# The fake reviewer of the #1537 acceptance tests (README, The fake reviewer): a fake `claude`, installed first on the
# login shell's PATH the runner records, standing in for the second model. Perl, as #87's and #159's fakes, so it runs
# inside the runner's sandbox with only the system's own runtime. It answers what DeepBuild's runner asks of Claude
# Code: `--version` (the newest version the facts cover), `auth status` (signed in), and a headless run
# (`-p --output-format stream-json --verbose`, the prompt on stdin), for which it prints one stream-json run in Claude
# Code's own shapes: system/init, one assistant message and a result event, each naming the model that answered.
#
# Its answer, the run's final result text, is the review check's ReviewerAnswer as JSON: {"findings": [...],
# "summary": "..."}, each finding {file, line, rule, quote}; the summary is the reviewer's prose, which never counts.
# It reports a baked finding when the code it is shown holds the finding's quote: the quote in its prompt (the diff),
# or at the finding's file and line in its working folder (a checkout of the claim's commit). The rule is the one the
# rubric in its prompt gives the finding's rubric text, else the first `- <kebab-rule>: <text>` rubric line its prompt
# holds, else the baked rule. It makes no network call and writes nothing.
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(decode_base64);

my $C = decode_json(decode_base64('__CONFIG__'));
my $json = JSON::PP->new->canonical(1);
$| = 1;

my @argv = @ARGV;
if (grep { $_ eq '--version' || $_ eq '-v' } @argv) { print "$C->{version} (Claude Code)\n"; exit 0; }
if (@argv >= 2 && $argv[0] eq 'auth' && $argv[1] eq 'status') {
  print $json->encode({ loggedIn => JSON::PP::true, authMethod => 'claude.ai', apiProvider => 'firstParty', subscriptionType => 'max' }), "\n";
  exit 0;
}
if (($ENV{CLAUDECODE} // '') eq '1') {
  print STDERR "Error: Claude Code cannot be launched inside another Claude Code session.\n";
  exit 1;
}
unless (grep { $_ eq '-p' || $_ eq '--print' } @argv) { print STDERR "fake reviewer: only headless runs (-p) are modelled\n"; exit 1; }

my $prompt = do { local $/; <STDIN> } // '';

sub uuid {
  open(my $r, '<', '/dev/urandom') or return sprintf('%08x-0000-4000-8000-%012x', $$, time);
  read($r, my $b, 16); close $r;
  my $h = unpack('H*', $b);
  return join('-', substr($h, 0, 8), substr($h, 8, 4), '4' . substr($h, 13, 3), '8' . substr($h, 17, 3), substr($h, 20, 12));
}
sub line_of {
  my ($file, $n) = @_;
  open(my $f, '<', $file) or return undef;
  my $i = 0;
  while (my $l = <$f>) { if (++$i == $n) { close $f; return $l; } }
  close $f;
  return undef;
}
sub rule_for {
  my ($f) = @_;
  my $text = quotemeta($f->{ruleText});
  return $1 if $prompt =~ /([A-Za-z0-9][\w.-]*)\s*:\s*$text/i;
  return $1 if $prompt =~ /^\s*(?:[-*]|\d+[.)])\s+([a-z][a-z0-9]*(?:-[a-z0-9]+)+):\s+\S/m;
  return $f->{rule};
}

my @findings;
for my $f (@{ $C->{findings} }) {
  my $shown = index($prompt, $f->{quote}) >= 0;
  my $at = line_of($f->{file}, $f->{line});
  $shown ||= defined $at && index($at, $f->{quote}) >= 0;
  push @findings, { file => $f->{file}, line => $f->{line}, rule => rule_for($f), quote => $f->{quote} } if $shown;
}
my $answer = $json->encode({ findings => \@findings, summary => @findings ? 'I looked over the change; one line looks wrong to me.' : 'I found nothing to send back in this diff.' });

my $session = uuid();
my $model = $C->{model};
my $usage = { input_tokens => 4, cache_creation_input_tokens => 1200, cache_read_input_tokens => 9000, output_tokens => 640, service_tier => 'standard' };
print $json->encode({ type => 'system', subtype => 'init', cwd => '.', session_id => $session, model => $model, tools => ['Read', 'Grep', 'Glob'], mcp_servers => [],
  permissionMode => 'dontAsk', apiKeySource => 'none', claude_code_version => $C->{version}, output_style => 'default', uuid => uuid() }), "\n";
print $json->encode({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => uuid(), message => {
  id => 'msg_01dh1537' . substr(uuid(), 0, 8), type => 'message', role => 'assistant', model => $model, content => [{ type => 'text', text => $answer }],
  stop_reason => 'end_turn', stop_sequence => undef, usage => $usage } }), "\n";
print $json->encode({ type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 2100, duration_api_ms => 1900, num_turns => 1,
  result => $answer, session_id => $session, total_cost_usd => 0.0123, usage => $usage, permission_denials => [], uuid => uuid(),
  modelUsage => { $model => { inputTokens => 4, outputTokens => 640, cacheReadInputTokens => 9000, cacheCreationInputTokens => 1200, webSearchRequests => 0, costUSD => 0.0123, contextWindow => 200000 } } }), "\n";
exit 0;
