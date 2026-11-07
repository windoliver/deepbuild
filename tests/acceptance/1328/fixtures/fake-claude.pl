#!/usr/bin/perl
# A stand-in for `claude` for the #1328 acceptance tests (README, Stand-ins). It answers what the runner asks of Claude
# Code: `--version`, and a headless run that prints stream-json shaped as Claude Code's own (system/init, assistant
# messages with tool_use blocks, user tool results, a result event). It calls no model and no network.
#
# What it does in a job comes from a plan the test writes for that job, at <its own folder>/plans/<job folder>.json:
#   { "reads": ["/absolute/path", ...], "writes": { "path/relative/to/its/folder": "text", ... } }
# Its own folder is on the job's read grant. The file is keyed by the job's folder because a redraft gets the same
# inputs as the first draft, so its prompt can't tell the two apart. Each read and write is made for real, under the
# sandbox the job runs in, and shown as a Read or Write tool_use. A write goes through only when the job's flags let
# the Write tool through, as Claude Code's own flags do. Its last message is `fake:<JSON>`: its folder, its stdin and
# how each read and write went.
use strict;
use warnings;
use Cwd qw(abs_path getcwd);
use File::Basename qw(basename dirname);
use File::Path qw(make_path);
use JSON::PP;
use MIME::Base64 qw(encode_base64);
use Time::HiRes qw(sleep time);

my $VERSION = '__VERSION__';
my $MODEL = 'claude-haiku-4-5';
my $PLAN_WAIT = 180;
my $json = JSON::PP->new->canonical(1);
$| = 1;

if (grep { $_ eq '--version' } @ARGV) { print "$VERSION (Claude Code)\n"; exit 0; }

my %VALUE = map { $_ => 1 } qw(--output-format --input-format --model --mcp-config --setting-sources --permission-mode
  --allowedTools --allowed-tools --disallowedTools --disallowed-tools --tools --settings --add-dir --max-turns
  --append-system-prompt --system-prompt --agents);
my %flag;
for (my $i = 0; $i < @ARGV; $i++) {
  my $a = $ARGV[$i];
  if ($a =~ /^(--[^=]+)=(.*)$/s) { $flag{$1} = $2; }
  elsif ($VALUE{$a}) { $flag{$a} = $ARGV[++$i] // ''; }
  elsif ($a =~ /^-/) { $flag{$a} = 1; }
}
my @tools = defined $flag{'--tools'} ? grep { length } split(/[ ,]+/, $flag{'--tools'}) : ('Write');
my @allow = grep { length } split(/[ ,]+/, join(',', grep { defined } $flag{'--allowedTools'}, $flag{'--allowed-tools'}));
my $mode = $flag{'--dangerously-skip-permissions'} ? 'bypassPermissions' : ($flag{'--permission-mode'} // 'default');
my $can_write = (grep { $_ eq 'Write' } @tools) && ($mode eq 'bypassPermissions' || $mode eq 'acceptEdits' || grep { /^(Write|Edit)(\(|$)/ } @allow);

my $prompt = do { local $/; <STDIN> // '' };
my $cwd = getcwd();
my $session = sprintf('%08x-0000-4000-8000-%012x', $$, int(time * 1000) % (16 ** 12));
my $serial = 0;
sub id { $serial++; return "${session}-$serial"; }
sub out { print STDOUT $json->encode($_[0]), "\n"; }
sub said {
  my (@content) = @_;
  out({ type => 'assistant', session_id => $session, parent_tool_use_id => undef, uuid => id(), message => {
    id => 'msg_' . id(), type => 'message', role => 'assistant', model => $MODEL, content => \@content, stop_reason => undef,
    usage => { input_tokens => 12, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 7 } } });
}
sub tool {
  my ($name, $input, $failed) = @_;
  my $use = 'toolu_' . id();
  said({ type => 'tool_use', id => $use, name => $name, input => $input });
  out({ type => 'user', session_id => $session, uuid => id(), message => { role => 'user', content => [{ type => 'tool_result', tool_use_id => $use,
    is_error => $failed ? JSON::PP::true : JSON::PP::false, content => $failed || 'ok' }] } });
}

out({ type => 'system', subtype => 'init', cwd => $cwd, session_id => $session, model => $MODEL, tools => \@tools, mcp_servers => [],
  permissionMode => $mode, apiKeySource => 'none', claude_code_version => $VERSION, uuid => id() });

my $path = dirname(abs_path($0) // $0) . '/plans/' . basename($cwd) . '.json';
for (my $end = time + $PLAN_WAIT; !-f $path && time < $end;) { sleep(0.05); }
my $plan = {};
if (open(my $f, '<', $path)) { local $/; $plan = $json->decode(scalar <$f>); close $f; }

my (@reads, @writes, @denials);
for my $target (@{ $plan->{reads} // [] }) {
  my $ok = open(my $f, '<', $target);
  my $why = $ok ? '' : "$!";
  if ($ok) { my $b; read($f, $b, 1); close $f; }
  tool('Read', { file_path => $target }, $why);
  push @reads, { path => $target, ok => $ok ? JSON::PP::true : JSON::PP::false, error => $why };
}
for my $rel (sort keys %{ $plan->{writes} // {} }) {
  my $target = "$cwd/$rel";
  my $text = $plan->{writes}{$rel};
  my $why = '';
  if (!$can_write) {
    $why = 'permission to use Write was denied';
    push @denials, { tool_name => 'Write', tool_use_id => 'toolu_' . id(), tool_input => { file_path => $target, content => $text } };
  } else {
    make_path(dirname($target), { error => \my $errors });
    if (open(my $f, '>', $target)) { print $f $text; close $f; } else { $why = "$!"; }
  }
  tool('Write', { file_path => $target, content => $text }, $why);
  push @writes, { path => $rel, ok => $why ? JSON::PP::false : JSON::PP::true, error => $why };
}

said({ type => 'text', text => 'fake:' . $json->encode({ cwd => $cwd, stdin => encode_base64($prompt, ''), planned => -f $path ? JSON::PP::true : JSON::PP::false, reads => \@reads, writes => \@writes }) });
out({ type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 1200, duration_api_ms => 900, num_turns => 1, result => 'fake done',
  session_id => $session, total_cost_usd => 0.0123, usage => { input_tokens => 12, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 7 },
  modelUsage => { $MODEL => { inputTokens => 12, outputTokens => 7, costUSD => 0.0123 } }, permission_denials => \@denials, uuid => id() });
exit 0;
