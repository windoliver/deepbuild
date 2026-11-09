// Issue #1457: counts the app's frames and the file-system calls its main thread makes while GPUI draws one. Loaded with
// DYLD_INSERT_LIBRARIES into a debug deep-app (which carries no hardened runtime). Each frame is a CAMetalLayer
// nextDrawable; a call counts as a frame's when GPUI's Window::draw is on the stack. It writes one line per event to the
// file FRAME_FS_OUT names: `F` for a frame, `D <call> <path>` for a call inside a draw, `T <call>` for one outside it.
#include <dlfcn.h>
#include <execinfo.h>
#include <fcntl.h>
#include <objc/runtime.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <dirent.h>

static int out = -1;
static __thread int busy = 0;

static void say(const char *line) {
  if (out >= 0) write(out, line, strlen(line));
}

/** Whether GPUI's Window::draw is on this thread's stack. */
static int in_draw(void) {
  void *frames[256];
  int n = backtrace(frames, 256);
  for (int i = 0; i < n; i++) {
    Dl_info info;
    if (dladdr(frames[i], &info) && info.dli_sname && strstr(info.dli_sname, "6Window4draw")) return 1;
  }
  return 0;
}

static void seen(const char *call, const char *path) {
  if (busy || !pthread_main_np()) return;
  busy = 1;
  char line[1200];
  if (in_draw()) snprintf(line, sizeof line, "D %s %s\n", call, path ? path : "-");
  else snprintf(line, sizeof line, "T %s\n", call);
  say(line);
  busy = 0;
}

#define INTERPOSE(replacement, original) \
  __attribute__((used)) static struct { const void *r; const void *o; } _interpose_##original \
  __attribute__((section("__DATA,__interpose"))) = { (const void *)replacement, (const void *)original };

static int my_stat(const char *p, struct stat *b) { seen("stat", p); return stat(p, b); }
static int my_lstat(const char *p, struct stat *b) { seen("lstat", p); return lstat(p, b); }
static int my_fstatat(int fd, const char *p, struct stat *b, int f) { seen("fstatat", p); return fstatat(fd, p, b, f); }
static int my_access(const char *p, int m) { seen("access", p); return access(p, m); }
static int my_faccessat(int fd, const char *p, int m, int f) { seen("faccessat", p); return faccessat(fd, p, m, f); }
static DIR *my_opendir(const char *p) { seen("opendir", p); return opendir(p); }
static int my_open(const char *p, int f, ...) {
  va_list a; va_start(a, f); int m = (f & O_CREAT) ? va_arg(a, int) : 0; va_end(a);
  seen("open", p); return open(p, f, m);
}
static int my_openat(int fd, const char *p, int f, ...) {
  va_list a; va_start(a, f); int m = (f & O_CREAT) ? va_arg(a, int) : 0; va_end(a);
  seen("openat", p); return openat(fd, p, f, m);
}
INTERPOSE(my_stat, stat)
INTERPOSE(my_lstat, lstat)
INTERPOSE(my_fstatat, fstatat)
INTERPOSE(my_access, access)
INTERPOSE(my_faccessat, faccessat)
INTERPOSE(my_opendir, opendir)
INTERPOSE(my_open, open)
INTERPOSE(my_openat, openat)

static IMP next_drawable;
static id counted_next_drawable(id self, SEL sel) {
  say("F\n");
  return ((id (*)(id, SEL))next_drawable)(self, sel);
}

__attribute__((constructor)) static void start(void) {
  const char *path = getenv("FRAME_FS_OUT");
  if (path) out = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_APPEND, 0644);
  unsetenv("DYLD_INSERT_LIBRARIES");
  dlopen("/System/Library/Frameworks/QuartzCore.framework/QuartzCore", RTLD_NOW);
  Class layer = objc_getClass("CAMetalLayer");
  Method m = layer ? class_getInstanceMethod(layer, sel_registerName("nextDrawable")) : NULL;
  if (m) next_drawable = method_setImplementation(m, (IMP)counted_next_drawable);
  else say("X no CAMetalLayer nextDrawable\n");
}
