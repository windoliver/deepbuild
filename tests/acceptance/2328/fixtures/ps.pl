#!/usr/bin/perl
# A stand-in for `ps` (README, How ps waits are counted), installed first on the PATH the hub, deep-hook, `deep lease`
# and the leased command get, with the suite's folder written in for __DIR__, so it needs nothing from the environment
# it is run with. Each call runs the real /bin/ps with the same arguments and environment and passes on its output and
# status. Once that has ended, it appends one line to __DIR__/ps.log: its own PID, its parent's, its parent's parent's,
# when it started and when the real ps ended (ms since the epoch), the real ps's status, and its arguments. While
# __DIR__/hold exists, each call first waits the milliseconds it names, so two calls started together are seen running
# together however long a loaded machine takes to start the second.
use strict;
use warnings;
use Time::HiRes qw(time sleep);

my $dir = '__DIR__';
my $start = int(time() * 1000);
my $ppid = getppid();
my $gppid = `/bin/ps -o ppid= -p $ppid`;
$gppid = defined $gppid ? $gppid =~ s/\s+//gr : '';
$gppid = 0 unless $gppid =~ /^\d+$/;
if (open(my $h, '<', "$dir/hold")) {
  my $ms = <$h> // 0;
  close $h;
  $ms =~ s/\s+//g;
  sleep($ms / 1000) if $ms =~ /^\d+$/ && $ms > 0;
}
open(my $ps, '-|', '/bin/ps', @ARGV) or die "ps: can't run /bin/ps: $!";
my $out = do { local $/; <$ps> } // '';
close $ps;
my $status = $? >> 8;
my $end = int(time() * 1000);
open(my $log, '>>', "$dir/ps.log") or die "ps: no log: $!";
print $log join("\t", $$, $ppid, $gppid, $start, $end, $status, join(' ', @ARGV)), "\n";
close $log;
print $out;
exit $status;
