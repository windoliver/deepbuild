#!/usr/bin/perl
# A fake `claude` for the #159 acceptance tests (README, The fake CLI). It answers what DeepBuild's runner asks of
# Claude Code (`--version`, `auth status`, and a headless run: `-p --output-format stream-json --verbose`, the
# prompt on stdin) and prints stream-json shaped as Claude Code's own: a system/init event (session_id, model,
# tools, mcp_servers, permissionMode, apiKeySource, claude_code_version), assistant messages with message.id,
# message.model and message.usage, and a result event (subtype, is_error, result, session_id, total_cost_usd,
# usage, modelUsage, permission_denials). It models the Claude Code behaviour the criteria lean on, from its flags
# and files alone: it refuses to start inside another Claude Code session (CLAUDECODE=1); loads the user-level and
# project MCP servers unless --strict-mcp-config; loads the checkout's .claude/settings.json (its SessionStart
# hooks, run and reported as system/hook_response, and its env block) only when --setting-sources names project;
# and lets the Write tool through only with a bypass flag, an edit permission mode or an allow rule. It makes no
# network call except the one an env block's ANTHROPIC_BASE_URL points at, as an API call would.
#
# What it does in a run comes from `@` lines in its prompt, so the test that writes the job's prompt drives it:
#   @session <id>         use this session ID       @answered-by <model|none>  the model its messages name
#   @delay-init <ms>      wait before init           @env                       report its environment
#   @read <path>          try to read a file, or connect to a socket and read
#   @write <rel> <text>   ask the Write tool to write a file in its folder
#   @spawn-sleeper <s>    fork /bin/sleep <s> in its group             @sleep <ms>   wait
#   @busy <ms>            burn CPU, printing nothing                    @linger <ms>  keep running after the result
#   @keep-writing <ms>    after the result, a child writes to stderr every 100 ms for <ms>
#   @ignore-term          ignore SIGTERM                                @close-output close stdout, print no result
#   @chatter <n> [<ms>]   print n assistant messages, <ms> apart
# Each report is an assistant text `fake:<JSON>`; the first is always {"cmd":"start", argv0, version, pid, cwd,
# argv, stdin (base64)}.
use strict;
use warnings;
use JSON::PP;
use MIME::Base64 qw(encode_base64);
use POSIX qw(_exit);
use IO::Socket::UNIX;
use IO::Socket::INET;
use Cwd qw(getcwd abs_path);
use Time::HiRes qw(sleep time);

my $VERSION = '__VERSION__';
my $SLOW_VERSION = __SLOW__;
my $EVIL = __EVIL__;
my $STARTUP = __STARTUP__;
my $json = JSON::PP->new->canonical(1);
$| = 1;

sub out { my ($obj) = @_; print STDOUT $json->encode($obj), "\n"; }
sub uuid {
  open(my $r, '<', '/dev/urandom') or return sprintf('%08x-0000-4000-8000-%012x', $$, int(time * 1000));
  read($r, my $b, 16); close $r;
  my $h = unpack('H*', $b);
  return join('-', substr($h, 0, 8), substr($h, 8, 4), '4' . substr($h, 13, 3), '8' . substr($h, 17, 3), substr($h, 20, 12));
}
sub read_json { my ($p) = @_; open(my $f, '<', $p) or return undef; local $/; my $t = <$f>; close $f; my $v = eval { decode_json($t) }; return $v; }

my @argv = @ARGV;
if (grep { $_ eq '--version' || $_ eq '-v' } @argv) {
  print "$VERSION (Claude Code)\n";
  sleep($SLOW_VERSION) if $SLOW_VERSION;
  exit 0;
}
if (@argv >= 2 && $argv[0] eq 'auth' && $argv[1] eq 'status') {
  out({ loggedIn => JSON::PP::true, authMethod => 'claude.ai', apiProvider => 'firstParty', subscriptionType => 'max' });
  exit 0;
}
if (($ENV{CLAUDECODE} // '') eq '1') {
  print STDERR "Error: Claude Code cannot be launched inside another Claude Code session.\n";
  exit 1;
}

# ---- Flags, as Claude Code takes them.
my %VALUE = map { $_ => 1 } qw(--output-format --input-format --model --mcp-config --setting-sources --permission-mode --allowedTools
  --allowed-tools --disallowedTools --disallowed-tools --tools --settings --resume -r --session-id --add-dir --max-turns
  --append-system-prompt --system-prompt --fallback-model --permission-prompt-tool --agents --plugin-dir);
my (%flag, @mcp, @positional);
for (my $i = 0; $i < @argv; $i++) {
  my $a = $argv[$i];
  if ($a =~ /^(--[^=]+)=(.*)$/s) { $flag{$1} = $2; push @mcp, $2 if $1 eq '--mcp-config'; next; }
  if ($VALUE{$a}) { my $v = $argv[++$i] // ''; $flag{$a} = $v; push @mcp, $v if $a eq '--mcp-config'; next; }
  if ($a =~ /^-/) { $flag{$a} = 1; next; }
  push @positional, $a;
}
my $print = $flag{'-p'} || $flag{'--print'};
my $format = $flag{'--output-format'} // 'text';
unless ($print) { print STDERR "fake claude: only headless runs (-p) are modelled\n"; exit 1; }
if ($format eq 'stream-json' && !$flag{'--verbose'}) {
  print STDERR "Error: When using --print, --output-format=stream-json requires --verbose\n";
  exit 1;
}

sleep($STARTUP) if $STARTUP;
my $prompt = '';
if (@positional) { $prompt = join(' ', @positional); }
else { local $/; $prompt = <STDIN> // ''; }

my %opt;
my @cmds;
for my $line (split /\n/, $prompt) {
  next unless $line =~ /^\@([a-z][a-z-]*)\s*(.*?)\s*$/;
  my ($c, $arg) = ($1, $2);
  if ($c eq 'session' || $c eq 'answered-by' || $c eq 'delay-init' || $c eq 'linger' || $c eq 'keep-writing' || $c eq 'close-output' || $c eq 'ignore-term') { $opt{$c} = $arg eq '' ? 1 : $arg; }
  else { push @cmds, [$c, $arg]; }
}
$SIG{TERM} = 'IGNORE' if $opt{'ignore-term'};

my $home = $ENV{HOME} // '/nonexistent';
my $cwd = getcwd();
my $session = $opt{session} // uuid();
my $launched = $flag{'--model'} // 'claude-sonnet-4-5';
my $answered = $opt{'answered-by'} // $launched;
$answered = undef if $answered eq 'none';
my $init_model = defined $opt{'answered-by'} && $opt{'answered-by'} eq 'none' ? undef : $launched;

# ---- Settings sources: project settings (the checkout's .claude/settings.json) only when named.
my %sources = map { $_ => 1 } split /[ ,]+/, ($flag{'--setting-sources'} // 'user,project,local');
my @events_before;
my @settings;
push @settings, ["$home/.claude/settings.json", 'user'] if $sources{user};
push @settings, ["$cwd/.claude/settings.json", 'project'] if $sources{project};
push @settings, ["$cwd/.claude/settings.local.json", 'local'] if $sources{local};
my @allow;
for my $s (@settings) {
  my $v = read_json($s->[0]) or next;
  if (ref $v->{env} eq 'HASH') { $ENV{$_} = $v->{env}{$_} for keys %{ $v->{env} }; }
  if (ref $v->{permissions} eq 'HASH' && ref $v->{permissions}{allow} eq 'ARRAY') { push @allow, @{ $v->{permissions}{allow} }; }
  my $hooks = ref $v->{hooks} eq 'HASH' ? $v->{hooks}{SessionStart} : undef;
  next unless ref $hooks eq 'ARRAY';
  for my $m (@$hooks) {
    for my $h (@{ ref $m->{hooks} eq 'ARRAY' ? $m->{hooks} : [] }) {
      next unless ($h->{type} // 'command') eq 'command' && defined $h->{command};
      my $code = system('/bin/sh', '-c', $h->{command}) >> 8;
      push @events_before, { type => 'system', subtype => 'hook_response', hook_name => 'SessionStart:startup', hook_event => 'SessionStart',
        source => $s->[1], command => $h->{command}, exit_code => $code, session_id => $session, uuid => uuid() };
    }
  }
}
# The env block's ANTHROPIC_BASE_URL is where its API calls would go: one connection, as a first call.
if (defined $ENV{ANTHROPIC_BASE_URL} && $ENV{ANTHROPIC_BASE_URL} =~ m{^https?://([^/:]+):(\d+)}) {
  my $s = IO::Socket::INET->new(PeerAddr => $1, PeerPort => $2, Proto => 'tcp', Timeout => 2);
  if ($s) { print $s "POST /v1/messages HTTP/1.1\r\nHost: $1\r\n\r\n"; close $s; }
}

# ---- MCP servers: --mcp-config's; and, without --strict-mcp-config, the user's (~/.claude.json) and the project's (.mcp.json).
my %servers;
for my $m (@mcp) {
  my $v = $m =~ /^\s*\{/ ? eval { decode_json($m) } : read_json($m);
  next unless ref $v eq 'HASH' && ref $v->{mcpServers} eq 'HASH';
  $servers{$_} = $v->{mcpServers}{$_} for keys %{ $v->{mcpServers} };
}
unless ($flag{'--strict-mcp-config'}) {
  my $user = read_json("$home/.claude.json");
  if (ref $user eq 'HASH') {
    if (ref $user->{mcpServers} eq 'HASH') { $servers{$_} //= $user->{mcpServers}{$_} for keys %{ $user->{mcpServers} }; }
    my $p = ref $user->{projects} eq 'HASH' ? $user->{projects}{$cwd} : undef;
    if (ref $p eq 'HASH' && ref $p->{mcpServers} eq 'HASH') { $servers{$_} //= $p->{mcpServers}{$_} for keys %{ $p->{mcpServers} }; }
  }
  if ($sources{project}) {
    my $proj = read_json("$cwd/.mcp.json");
    if (ref $proj eq 'HASH' && ref $proj->{mcpServers} eq 'HASH') { $servers{$_} //= $proj->{mcpServers}{$_} for keys %{ $proj->{mcpServers} }; }
  }
}
# Each stdio server is started, as Claude Code starts it, in the session's folder.
my @server_pids;
for my $name (sort keys %servers) {
  my $s = $servers{$name};
  next unless ref $s eq 'HASH' && defined $s->{command};
  my $pid = fork();
  if (defined $pid && $pid == 0) {
    if (ref $s->{env} eq 'HASH') { $ENV{$_} = $s->{env}{$_} for keys %{ $s->{env} }; }
    open(STDIN, '<', '/dev/null'); open(STDOUT, '>', '/dev/null');
    exec($s->{command}, @{ ref $s->{args} eq 'ARRAY' ? $s->{args} : [] }) or _exit(127);
  }
  push @server_pids, $pid if $pid;
}
for my $pid (@server_pids) { for (1 .. 40) { last if waitpid($pid, POSIX::WNOHANG()) != 0; sleep(0.05); } }

# ---- Tools and permissions.
my @tools = qw(Task Bash Glob Grep LS Read Edit MultiEdit Write NotebookEdit WebFetch WebSearch TodoWrite);
if (defined $flag{'--tools'}) {
  my $t = $flag{'--tools'};
  @tools = $t eq 'default' ? @tools : grep { length } split /[ ,]+/, $t;
}
my %disallowed = map { $_ => 1 } split /[ ,]+/, join(',', grep { defined } $flag{'--disallowedTools'}, $flag{'--disallowed-tools'});
@tools = grep { !$disallowed{$_} } @tools;
push @tools, map { "mcp__${_}__probe" } sort keys %servers;
push @allow, split /[ ,]+/, join(',', grep { defined } $flag{'--allowedTools'}, $flag{'--allowed-tools'});
my $mode = $flag{'--dangerously-skip-permissions'} ? 'bypassPermissions' : ($flag{'--permission-mode'} // 'default');
my $can_write = (grep { $_ eq 'Write' } @tools) && ($mode eq 'bypassPermissions' || $mode eq 'acceptEdits' || grep { /^(Write|Edit)(\(|$)/ } @allow);

sleep($opt{'delay-init'} / 1000) if $opt{'delay-init'};
out($_) for @events_before;
my %init = (type => 'system', subtype => 'init', cwd => $cwd, session_id => $session, tools => \@tools,
  mcp_servers => [map { { name => $_, status => 'connected' } } sort keys %servers], permissionMode => $mode, slash_commands => [],
  apiKeySource => defined $ENV{ANTHROPIC_API_KEY} ? 'ANTHROPIC_API_KEY' : 'none', claude_code_version => $VERSION, output_style => 'default',
  agents => [], skills => [], plugins => [], uuid => uuid());
$init{model} = $init_model if defined $init_model;
out(\%init);

# ---- Its transcript, where Claude Code keeps one (best effort: the sandbox may refuse it).
(my $munged = $cwd) =~ s{[^A-Za-z0-9]}{-}g;
my $transcript = "$home/.claude/projects/$munged/$session.jsonl";
my $tfh;
eval { system('/bin/mkdir', '-p', "$home/.claude/projects/$munged"); open($tfh, '>>', $transcript) or undef $tfh; };
sub transcribe { my ($o) = @_; print $tfh $json->encode($o), "\n" if $tfh; }
transcribe({ type => 'user', sessionId => $session, cwd => $cwd, message => { role => 'user', content => $prompt }, uuid => uuid() });

my $turns = 0;
my %usage = (input_tokens => 0, cache_creation_input_tokens => 0, cache_read_input_tokens => 0, output_tokens => 0);
sub say_text {
  my ($text) = @_;
  $turns++;
  my %u = (input_tokens => 12, cache_creation_input_tokens => 3, cache_read_input_tokens => 100, output_tokens => 7);
  $usage{$_} += $u{$_} for keys %u;
  my %msg = (id => 'msg_' . substr(uuid(), 0, 8), type => 'message', role => 'assistant', content => [{ type => 'text', text => $text }],
    stop_reason => undef, usage => \%u);
  $msg{model} = $answered if defined $answered;
  my %event = (type => 'assistant', message => \%msg, session_id => $session, parent_tool_use_id => undef, uuid => uuid());
  out(\%event);
  transcribe(\%event);
}
sub report { say_text('fake:' . $json->encode($_[0])); }

if ($EVIL) { say_text('EVIL RAN'); }
report({ cmd => 'start', argv0 => abs_path($0) // $0, version => $VERSION, pid => $$, cwd => $cwd, argv => \@argv, stdin => encode_base64($prompt, '') });

my @denials;
for my $c (@cmds) {
  my ($name, $arg) = @$c;
  if ($name eq 'env') { report({ cmd => 'env', env => {%ENV} }); }
  elsif ($name eq 'read') {
    my $ok = 0; my $errno = '';
    if (-S $arg) {
      my $s = IO::Socket::UNIX->new(Peer => $arg, Type => SOCK_STREAM());
      if ($s) { $ok = 1; close $s; } else { $errno = ($!{EPERM} ? 'EPERM' : $!{EACCES} ? 'EACCES' : $!{ENOENT} ? 'ENOENT' : $!{ECONNREFUSED} ? 'ECONNREFUSED' : "$!"); }
    } elsif (open(my $f, '<', $arg)) { my $b; read($f, $b, 1); $ok = 1; close $f; }
    else { $errno = ($!{EPERM} ? 'EPERM' : $!{EACCES} ? 'EACCES' : $!{ENOENT} ? 'ENOENT' : "$!"); }
    report({ cmd => 'read', path => $arg, ok => $ok ? JSON::PP::true : JSON::PP::false, errno => $errno });
  }
  elsif ($name eq 'write') {
    my ($rel, $text) = split /\s+/, $arg, 2;
    my $path = "$cwd/$rel";
    my $id = 'toolu_' . substr(uuid(), 0, 8);
    if (!$can_write) {
      push @denials, { tool_name => 'Write', tool_use_id => $id, tool_input => { file_path => $path, content => $text // '' } };
      report({ cmd => 'write', path => $path, ok => JSON::PP::false, denied => JSON::PP::true });
    } elsif (open(my $f, '>', $path)) { print $f ($text // ''); close $f; report({ cmd => 'write', path => $path, ok => JSON::PP::true }); }
    else { report({ cmd => 'write', path => $path, ok => JSON::PP::false, errno => ($!{EPERM} ? 'EPERM' : "$!") }); }
  }
  elsif ($name eq 'spawn-sleeper') {
    my $pid = fork();
    if (defined $pid && $pid == 0) { open(STDOUT, '>', '/dev/null'); exec('/bin/sleep', $arg || '600') or _exit(127); }
    report({ cmd => 'spawn', pid => $pid });
  }
  elsif ($name eq 'sleep') { sleep($arg / 1000); }
  elsif ($name eq 'chatter') { my ($n, $ms) = split /\s+/, $arg; for my $i (1 .. $n) { say_text("chatter $i"); sleep($ms / 1000) if $ms; } }
  elsif ($name eq 'busy') { my $end = time + $arg / 1000; my $x = 0; while (time < $end) { $x = ($x * 31 + 7) % 1000003 for 1 .. 20000; } }
}

if ($opt{'close-output'}) {
  close STDOUT;
} else {
  my $denied = @denials > 0;
  my $result = $EVIL ? 'EVIL RAN' : $denied ? 'I could not write the file: permission to use Write was denied.' : 'fake done';
  my %result = (type => 'result', subtype => 'success', is_error => JSON::PP::false, duration_ms => 1200, duration_api_ms => 900, num_turns => $turns,
    result => $result, session_id => $session, total_cost_usd => 0.0123, usage => { %usage, service_tier => 'standard' },
    permission_denials => \@denials, uuid => uuid());
  $result{modelUsage} = { $answered => { inputTokens => $usage{input_tokens}, outputTokens => $usage{output_tokens}, costUSD => 0.0123 } } if defined $answered;
  out(\%result);
}
close $tfh if $tfh;

if ($opt{'keep-writing'}) {
  my $pid = fork();
  if (defined $pid && $pid == 0) {
    my $end = time + $opt{'keep-writing'} / 1000;
    while (time < $end) { print STDERR "still writing\n"; sleep(0.1); }
    _exit(0);
  }
}
sleep($opt{linger} / 1000) if $opt{linger};
exit 0;
