#!/usr/bin/perl
# The fake reviewer of the #1862 acceptance tests (README, The fake reviewer): a fake `claude`, installed first on the
# login shell's PATH the runner records, standing in for the second model. Perl, as #1537's and #87's fakes, so it runs
# inside the runner's sandbox with only the system's own runtime. It answers what DeepBuild's runner asks of Claude
# Code: `--version` (the newest version the facts cover), `auth status` (signed in), and a headless run
# (`-p --output-format stream-json --verbose`, the prompt on stdin), for which it prints one stream-json run in Claude
# Code's own shapes: system/init, one assistant message and a result event, each naming the model that answered.
#
# It reads the diff it is given by rule, as a careful second model would, and nothing else: every line on the new side
# of the unified diff in its prompt, added or context, that matches one of its baked rules is a finding at that file
# and line, quoting the line. A line the diff doesn't show is never a finding, so what a round is given decides what
# it reports. Its answer, the run's final result text, is the review check's ReviewerAnswer as JSON: {"findings":
# [{file, line, rule, quote}], "summary": "...", "given": "..."}; the summary is the reviewer's prose, which never
# counts, and `given` is the prompt it was handed, byte for byte, which is how the tests read what each round was
# given. It makes no network call and writes nothing.
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

# Every line of the prompt's unified diff on the new side, added or context, with its file and new line number.
my @findings;
my ($file, $line, $in_hunk) = ('', 0, 0);
for my $raw (split /\n/, $prompt, -1) {
  if ($raw =~ /^diff --git /) { $in_hunk = 0; next; }
  if (!$in_hunk && $raw =~ /^\+\+\+ (.*)$/) { ($file = $1) =~ s{^b/}{}; next; }
  if ($raw =~ /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/) { $in_hunk = 1; $line = $1; next; }
  next unless $in_hunk;
  next unless $raw =~ /^[+ ]/;
  my $text = substr($raw, 1);
  for my $rule (@{ $C->{rules} }) {
    next unless $text =~ /$rule->{re}/;
    (my $quote = $text) =~ s/^\s+|\s+$//g;
    push @findings, { file => $file, line => $line + 0, rule => $rule->{rule}, quote => $quote };
  }
  $line++;
}
my $n = scalar @findings;
my $answer = $json->encode({
  findings => \@findings,
  summary => $n ? "I looked over the change; $n line" . ($n == 1 ? ' looks' : 's look') . ' wrong to me.' : 'I found nothing to send back in this diff.',
  given => $prompt,
});

my $session = uuid();
my $model = $C->{model};
my $usage = { input_tokens => 4, cache_creation_input_tokens => 1200, cache_read_input_tokens => 9000, output_tokens => 640, service_tier => 'standard' };
print $json->encode({ type => 'system', subtype => 'init', cwd => '.', session_id => $session, model => $model, tools => ['Read', 'Grep', 'Glob'], mcp_servers => [],
  permissionMode => 'dontAsk', apiKeySource => 'none', claude_code_version => $C->{version}, output_style => 'default', uuid => uuid() }), "\n";
print $json->encode({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => uuid(), message => {
  id => 'msg_01dh1862' . substr(uuid(), 0, 8), type => 'message', role => 'assistant', model => $model, content => [{ type => 'text', text => $answer }],
  stop_reason => 'end_turn', stop_sequence => undef, usage => $usage } }), "\n";
print $json->encode({ type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 2100, duration_api_ms => 1900, num_turns => 1,
  result => $answer, session_id => $session, total_cost_usd => 0.0123, usage => $usage, permission_denials => [], uuid => uuid(),
  modelUsage => { $model => { inputTokens => 4, outputTokens => 640, cacheReadInputTokens => 9000, cacheCreationInputTokens => 1200, webSearchRequests => 0, costUSD => 0.0123, contextWindow => 200000 } } }), "\n";
exit 0;
