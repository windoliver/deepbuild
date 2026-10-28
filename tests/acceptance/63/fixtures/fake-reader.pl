#!/usr/bin/perl
# A fake `claude` for the #63 acceptance tests (README, The fake agent): the model and the CLI are the one boundary
# these tests don't own, so this stands in for both. It answers what DeepBuild's runner asks of Claude Code
# (`--version`, `auth status`, a headless run: `-p --output-format stream-json --verbose`, the prompt on stdin) with
# stream-json shaped as Claude Code's own (#159's fake), and works as an agent reading by reference would:
#
# - Its context is what Claude Code puts in a model's context: the system prompt flags (`--system-prompt`,
#   `--append-system-prompt`), CLAUDE.md in its folder (and ~/.claude/CLAUDE.md when user settings load), its stdin,
#   and every tool result it gets. It reports each, verbatim, as a `system`/`fake` line, so the tests read every
#   prompt it was sent.
# - The handles it may read are the `session:`, `ev:` and `wiki:` handles in that context.
# - It reads only through MCP: the first server from `--mcp-config` (and, without `--strict-mcp-config`, the user's)
#   whose `tools/list` has a tool named `read`, called with `{handle}` and then `{handle, slice}` while a reply's
#   `next` says it was cut, at most MAX_SLICES slices of each handle. A call to a tool the permission mode doesn't
#   allow (`dontAsk`/`default` without an `--allowedTools` entry naming it) is denied, as Claude Code denies it.
# - With more than GROUP handles and the Task tool, it hands them to sub-agents, GROUP each, in one turn (in parallel,
#   as Claude Code runs Task calls of one turn). A sub-agent runs on the model of the first agent `--agents` defines
#   (by name), or the session's when none does; its messages carry `parent_tool_use_id`, and the result's
#   `modelUsage` names each model.
# - Its findings: each `remember: <quote>.` in a message of a slice, cited at that message's handle with the exact
#   quote. Its answer, the result's text, is `{"findings": [{"text", "cites": [{"at", "quote"}]}]}`
#   (reading.answer@1). A top-level run (not a sub-agent) adds the PLANTED findings to its answer as they are.
# - Its usage is honest: each turn's input_tokens is its context so far, output_tokens what the turn printed, in
#   characters / 4 rounded up, no cache.
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(decode_base64);
use IPC::Open2;
use POSIX qw(ceil _exit);
use Cwd qw(getcwd);

my $VERSION = '__VERSION__';
my $PLANTED = decode_json(decode_base64('__PLANTED__'));
my $GROUP = 6;
my $MAX_SLICES = 1;
my $json = JSON::PP->new->canonical(1);
$| = 1;

sub out { print STDOUT $json->encode($_[0]), "\n"; }
my $n = 0;
sub uid { $n++; return sprintf('%08x-%04x-4%03x-8%03x-%012x', $$, $n & 0xffff, $n & 0xfff, int(rand(4096)), int(rand(2**40))); }
sub report { out({ type => 'system', subtype => 'fake', report => $_[0], uuid => uid() }); }
sub slurp { my ($p) = @_; open(my $f, '<', $p) or return undef; local $/; my $t = <$f>; close $f; return $t; }

my @argv = @ARGV;
if (grep { $_ eq '--version' || $_ eq '-v' } @argv) { print "$VERSION (Claude Code)\n"; exit 0; }
if (@argv >= 2 && $argv[0] eq 'auth' && $argv[1] eq 'status') {
  out({ loggedIn => JSON::PP::true, authMethod => 'claude.ai', apiProvider => 'firstParty', subscriptionType => 'max' });
  exit 0;
}
if (($ENV{CLAUDECODE} // '') eq '1') { print STDERR "Error: Claude Code cannot be launched inside another Claude Code session.\n"; exit 1; }

# ---- Flags, as Claude Code takes them.
my %VALUE = map { $_ => 1 } qw(--output-format --input-format --model --mcp-config --setting-sources --permission-mode --allowedTools
  --allowed-tools --disallowedTools --disallowed-tools --tools --settings --resume -r --session-id --add-dir --max-turns
  --append-system-prompt --system-prompt --fallback-model --permission-prompt-tool --agents --plugin-dir --json-schema);
my (%flag, @mcp, @allow_flags, @positional);
for (my $i = 0; $i < @argv; $i++) {
  my ($a, $v) = ($argv[$i], undef);
  if ($a =~ /^(--[^=]+)=(.*)$/s) { ($a, $v) = ($1, $2); }
  elsif ($VALUE{$a}) { $v = $argv[++$i] // ''; }
  elsif ($a =~ /^-/) { $flag{$a} = 1; next; }
  else { push @positional, $a; next; }
  $flag{$a} = $v;
  push @mcp, $v if $a eq '--mcp-config';
  push @allow_flags, $v if $a eq '--allowedTools' || $a eq '--allowed-tools';
}
unless ($flag{'-p'} || $flag{'--print'}) { print STDERR "fake claude: only headless runs (-p) are modelled\n"; exit 1; }
if (($flag{'--output-format'} // 'text') eq 'stream-json' && !$flag{'--verbose'}) {
  print STDERR "Error: When using --print, --output-format=stream-json requires --verbose\n"; exit 1;
}
my $stdin = '';
if (@positional) { $stdin = join(' ', @positional); } else { local $/; $stdin = <STDIN> // ''; }

my $home = $ENV{HOME} // '/nonexistent';
my $cwd = getcwd();
my $session = uid();
my %ALIAS = (haiku => 'claude-haiku-5-5', sonnet => 'claude-sonnet-5-5', opus => 'claude-opus-5-5', fable => 'claude-fable-5-1');
sub model_of { my ($m, $inherit) = @_; return $inherit if !defined $m || $m eq '' || $m eq 'inherit'; return $ALIAS{$m} // $m; }
my $main_model = model_of($flag{'--model'}, 'claude-sonnet-5-5');
my %sources = map { $_ => 1 } split /[ ,]+/, ($flag{'--setting-sources'} // 'user,project,local');

# ---- Sub-agents, as --agents defines them.
my ($sub_name, $sub_model, $sub_system) = (undef, $main_model, '');
if (defined $flag{'--agents'}) {
  my $agents = eval { decode_json($flag{'--agents'}) };
  if (ref $agents eq 'HASH' && %$agents) {
    $sub_name = (sort keys %$agents)[0];
    my $def = $agents->{$sub_name};
    $sub_model = model_of(ref $def eq 'HASH' ? $def->{model} : undef, $main_model);
    $sub_system = ref $def eq 'HASH' ? ($def->{prompt} // '') : '';
  }
}

# ---- Tools and permissions.
my @tools = qw(Task Bash Glob Grep LS Read Edit MultiEdit Write NotebookEdit WebFetch WebSearch TodoWrite);
if (defined $flag{'--tools'}) { my $t = $flag{'--tools'}; @tools = $t eq 'default' ? @tools : grep { length } split /[ ,]+/, $t; }
my %disallowed = map { $_ => 1 } split /[ ,]+/, join(',', grep { defined } $flag{'--disallowedTools'}, $flag{'--disallowed-tools'});
@tools = grep { !$disallowed{$_} } @tools;
my $mode = $flag{'--dangerously-skip-permissions'} ? 'bypassPermissions' : ($flag{'--permission-mode'} // 'default');
my @allow = map { split /[ ,]+/ } @allow_flags;
sub allowed {
  my ($server, $tool) = @_;
  return 1 if $mode eq 'bypassPermissions';
  my $full = "mcp__${server}__${tool}";
  return 0 if $disallowed{$full};
  return scalar grep { $_ eq $full || $_ eq "mcp__${server}" || $_ eq "mcp__${server}__*" } @allow;
}

# ---- MCP servers: --mcp-config's, and without --strict-mcp-config the user's (~/.claude.json).
my %servers;
for my $m (@mcp) {
  my $v = $m =~ /^\s*\{/ ? eval { decode_json($m) } : eval { decode_json(slurp($m) // '') };
  next unless ref $v eq 'HASH' && ref $v->{mcpServers} eq 'HASH';
  $servers{$_} = $v->{mcpServers}{$_} for keys %{ $v->{mcpServers} };
}
unless ($flag{'--strict-mcp-config'}) {
  my $user = eval { decode_json(slurp("$home/.claude.json") // '') };
  if (ref $user eq 'HASH' && ref $user->{mcpServers} eq 'HASH') { $servers{$_} //= $user->{mcpServers}{$_} for keys %{ $user->{mcpServers} }; }
}
my $rpc_id = 0;
sub rpc {
  my ($srv, $method, $params) = @_;
  my $id = ++$rpc_id;
  my $in = $srv->{in};
  print $in $json->encode({ jsonrpc => '2.0', id => $id, method => $method, params => $params // {} }), "\n";
  my $fh = $srv->{out};
  local $SIG{ALRM} = sub { die "timeout\n" };
  alarm 60;
  my $got;
  while (my $line = <$fh>) {
    my $m = eval { decode_json($line) };
    next unless ref $m eq 'HASH' && defined $m->{id} && $m->{id} eq $id;
    $got = $m; last;
  }
  alarm 0;
  return $got;
}
my ($reader, $reader_name);
my @started;
my @server_names = sort keys %servers;
for my $name (@server_names) {
  my $s = $servers{$name};
  next unless ref $s eq 'HASH' && defined $s->{command};
  my ($out, $in);
  my $pid = eval {
    local %ENV = (%ENV, ref $s->{env} eq 'HASH' ? %{ $s->{env} } : ());
    open2($out, $in, $s->{command}, @{ ref $s->{args} eq 'ARRAY' ? $s->{args} : [] });
  };
  next unless $pid;
  my $srv = { pid => $pid, in => $in, out => $out };
  push @started, $srv;
  my $init = eval { rpc($srv, 'initialize', { protocolVersion => '2025-06-18', capabilities => {}, clientInfo => { name => 'claude-code', version => $VERSION } }) };
  next unless $init && $init->{result};
  print $in $json->encode({ jsonrpc => '2.0', method => 'notifications/initialized' }), "\n";
  my $list = eval { rpc($srv, 'tools/list', {}) };
  my @names = map { $_->{name} } @{ ref $list eq 'HASH' && ref $list->{result}{tools} eq 'ARRAY' ? $list->{result}{tools} : [] };
  push @tools, map { "mcp__${name}__$_" } @names;
  if (!$reader && grep { $_ eq 'read' } @names) { ($reader, $reader_name) = ($srv, $name); }
}

# ---- What enters the main context before its first turn.
my @claude_md;
for my $p ("$cwd/CLAUDE.md", "$cwd/.claude/CLAUDE.md", ($sources{user} ? ("$home/.claude/CLAUDE.md") : ())) {
  my $t = slurp($p);
  push @claude_md, { path => $p, text => $t } if defined $t;
}
my $system = join("\n", grep { defined } $flag{'--system-prompt'}, $flag{'--append-system-prompt'});
my %init = (type => 'system', subtype => 'init', cwd => $cwd, session_id => $session, tools => \@tools, model => $main_model,
  mcp_servers => [map { { name => $_, status => 'connected' } } @server_names], permissionMode => $mode, slash_commands => [],
  apiKeySource => defined $ENV{ANTHROPIC_API_KEY} ? 'ANTHROPIC_API_KEY' : 'none', claude_code_version => $VERSION,
  agents => [defined $sub_name ? ($sub_name) : ()], uuid => uid());
out(\%init);
report({ cmd => 'start', pid => $$, cwd => $cwd, argv => \@argv, stdin => $stdin, system => $system, claude_md => \@claude_md,
  model => $main_model, reader => $reader_name, sub_model => $sub_model, sub_system => $sub_system });

# ---- Agents, turns and honest usage.
my %usage_by_model;
my ($in_total, $out_total) = (0, 0);
sub agent { my ($model, $task, $context) = @_; return { model => $model, task => $task, ctx => length($context) }; }
sub turn {
  my ($ag, @content) = @_;
  my $printed = $json->encode(\@content);
  my %u = (input_tokens => ceil($ag->{ctx} / 4), cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => ceil(length($printed) / 4));
  $ag->{ctx} += length($printed);
  $usage_by_model{ $ag->{model} }{in} += $u{input_tokens};
  $usage_by_model{ $ag->{model} }{out} += $u{output_tokens};
  $in_total += $u{input_tokens}; $out_total += $u{output_tokens};
  out({ type => 'assistant', session_id => $session, parent_tool_use_id => $ag->{task}, uuid => uid(),
    message => { id => 'msg_' . uid(), type => 'message', role => 'assistant', model => $ag->{model}, content => \@content, stop_reason => undef, usage => \%u } });
}
sub tool_result {
  my ($ag, $id, $text, $error) = @_;
  $ag->{ctx} += length($text);
  out({ type => 'user', session_id => $session, parent_tool_use_id => $ag->{task}, uuid => uid(),
    message => { role => 'user', content => [{ type => 'tool_result', tool_use_id => $id, content => $text, ($error ? (is_error => JSON::PP::true) : ()) }] } });
}

my @denials;
# Reads one handle in an agent's context, slice after slice; returns the replies, decoded.
sub read_calls {
  my ($ag, @handles) = @_;
  my @replies;
  my @pending = map { { handle => $_, slices => 0 } } @handles;
  while (@pending) {
    my @calls = map { { id => 'toolu_' . uid(), p => $_, args => { handle => $_->{handle}, (defined $_->{next} ? (slice => $_->{next}) : ()) } } } @pending;
    turn($ag, map { { type => 'tool_use', id => $_->{id}, name => "mcp__${reader_name}__read", input => $_->{args} } } @calls);
    @pending = ();
    for my $c (@calls) {
      if (!allowed($reader_name, 'read')) {
        push @denials, { tool_name => "mcp__${reader_name}__read", tool_use_id => $c->{id}, tool_input => $c->{args} };
        tool_result($ag, $c->{id}, "Claude requested permissions to use mcp__${reader_name}__read, but you haven't granted it yet.", 1);
        report({ cmd => 'denied', task => $ag->{task}, tool => 'read', args => $c->{args} });
        next;
      }
      my $r = eval { rpc($reader, 'tools/call', { name => 'read', arguments => $c->{args} }) };
      my $res = ref $r eq 'HASH' ? $r->{result} : undef;
      my $text = ref $res eq 'HASH' && ref $res->{content} eq 'ARRAY' ? join('', map { $_->{text} // '' } @{ $res->{content} }) : (ref $r eq 'HASH' && $r->{error} ? $json->encode($r->{error}) : 'no reply');
      my $error = !(ref $res eq 'HASH') || $res->{isError};
      tool_result($ag, $c->{id}, $text, $error);
      report({ cmd => 'reply', task => $ag->{task}, tool => 'read', args => $c->{args}, text => $text, error => $error ? JSON::PP::true : JSON::PP::false });
      my $slice = $error ? undef : eval { decode_json($text) };
      next unless ref $slice eq 'HASH';
      push @replies, $slice;
      $c->{p}{slices}++;
      if (defined $slice->{next} && $c->{p}{slices} < $MAX_SLICES) { $c->{p}{next} = $slice->{next}; push @pending, $c->{p}; }
    }
  }
  return @replies;
}
# The findings in a slice: each `remember: <quote>.` of a message, cited at that message (or at the handle itself).
sub findings_in {
  my ($slice) = @_;
  my @found;
  my $text = $slice->{text} // '';
  my @parts = ref $slice->{messages} eq 'ARRAY'
    ? map { [$_->{at}, substr($text, $_->{start}, $_->{end} - $_->{start})] } grep { defined $_->{at} && defined $_->{start} && defined $_->{end} } @{ $slice->{messages} }
    : ([$slice->{handle}, $text]);
  for my $p (@parts) {
    my ($at, $t) = @$p;
    while ($t =~ /remember:[ \t]*([^\n]*?)\.(?=\s|$)/g) { push @found, { text => "remember: $1", cites => [{ at => $at, quote => $1 }] }; }
  }
  return @found;
}

my %seen;
my @handles = grep { !$seen{$_}++ } ("$system\n" . join("\n", map { $_->{text} } @claude_md) . "\n$stdin") =~ /\b((?:session:[0-9A-Za-z]+(?:#[A-Za-z0-9._-]+)?)|(?:ev:[0-9a-f]{64})|(?:wiki:[a-z0-9][a-z0-9_\/-]*#[A-Za-z0-9._-]+))/g;
my $main = agent($main_model, undef, $system . join('', map { $_->{text} } @claude_md) . $stdin);
my @findings;
if (!$reader) {
  report({ cmd => 'no-reader', servers => \@server_names });
} elsif (@handles > $GROUP && grep { $_ eq 'Task' } @tools) {
  my @groups;
  push @groups, [splice(@handles, 0, $GROUP)] while @handles;
  my @tasks = map { { id => 'toolu_' . uid(), handles => $_ } } @groups;
  for my $t (@tasks) { $t->{prompt} = "Read these handles, each a slice at a time, and quote what to remember:\n" . join("\n", @{ $t->{handles} }); }
  turn($main, { type => 'text', text => sprintf('Reading %d handles in %d sub-reads.', scalar(map { @{ $_->{handles} } } @tasks), scalar @tasks) },
    map { { type => 'tool_use', id => $_->{id}, name => 'Task', input => { description => 'sub-read', prompt => $_->{prompt}, subagent_type => $sub_name // 'general-purpose' } } } @tasks);
  for my $t (@tasks) {
    my $sub = agent($sub_model, $t->{id}, $sub_system . $t->{prompt});
    report({ cmd => 'subread', task => $t->{id}, model => $sub_model, prompt => $t->{prompt}, system => $sub_system });
    my @found = map { findings_in($_) } read_calls($sub, @{ $t->{handles} });
    my $answer = $json->encode({ findings => \@found });
    turn($sub, { type => 'text', text => $answer });
    tool_result($main, $t->{id}, $answer);
    push @findings, @found;
  }
} else {
  push @findings, map { findings_in($_) } read_calls($main, @handles);
}
push @findings, @$PLANTED;
my $answer = $json->encode({ findings => \@findings });
report({ cmd => 'answer', findings => \@findings, planted => scalar @$PLANTED });
turn($main, { type => 'text', text => $answer });

my %model_usage = map { $_ => { inputTokens => $usage_by_model{$_}{in}, outputTokens => $usage_by_model{$_}{out}, cacheReadInputTokens => 0, cacheCreationInputTokens => 0, costUSD => 0 } } keys %usage_by_model;
out({ type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 1000, duration_api_ms => 800, num_turns => 1,
  result => $answer, session_id => $session, total_cost_usd => 0,
  usage => { input_tokens => $in_total, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => $out_total, service_tier => 'standard' },
  modelUsage => \%model_usage, permission_denials => \@denials, uuid => uid() });
for my $s (@started) { close $s->{in}; waitpid($s->{pid}, 0); }
exit 0;
