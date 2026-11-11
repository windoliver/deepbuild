// Counts fsync, fdatasync and fcntl(F_FULLFSYNC / F_BARRIERFSYNC) calls a process makes, logging each to stderr.
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <unistd.h>
#define DYLD_INTERPOSE(_replacement, _replacee) \
  __attribute__((used)) static struct { const void *replacement; const void *replacee; } _interpose_##_replacee \
  __attribute__((section("__DATA,__interpose"))) = { (const void *)(unsigned long)&_replacement, (const void *)(unsigned long)&_replacee };
static int my_fsync(int fd) { fprintf(stderr, "SHIM fsync fd=%d\n", fd); return fsync(fd); }
static int my_fcntl(int fd, int cmd, ...) {
  va_list ap; va_start(ap, cmd); void *arg = va_arg(ap, void *); va_end(ap);
  if (cmd == F_FULLFSYNC) fprintf(stderr, "SHIM fcntl F_FULLFSYNC fd=%d\n", fd);
  if (cmd == 85) fprintf(stderr, "SHIM fcntl F_BARRIERFSYNC fd=%d\n", fd);
  return fcntl(fd, cmd, arg);
}
DYLD_INTERPOSE(my_fsync, fsync)
DYLD_INTERPOSE(my_fcntl, fcntl)
