// An open-recording shim for #2651 AC1 (README): injected into deep-hook with DYLD_INSERT_LIBRARIES, it appends the
// path of every open() and openat() the process makes, one line each, to the file OPENS_LOG names, and changes no
// call's result. macOS only: it interposes through dyld's __interpose section, so the calls this library makes itself
// go to the real functions. A test counts the lines that are ~/.deepbuild/config.json.
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

static int log_fd = -2;

static void note(int dirfd, const char *path) {
  if (log_fd == -2) {
    const char *file = getenv("OPENS_LOG");
    log_fd = file ? open(file, O_WRONLY | O_APPEND | O_CREAT | O_CLOEXEC, 0600) : -1;
  }
  if (log_fd < 0 || !path) return;
  char line[PATH_MAX * 2 + 4];
  size_t n = 0;
  // A path relative to a folder descriptor other than the working folder is written as fd:<n>/<path>.
  if (path[0] != '/' && dirfd != AT_FDCWD) {
    char dir[PATH_MAX];
    if (fcntl(dirfd, F_GETPATH, dir) == 0) {
      size_t d = strnlen(dir, PATH_MAX - 1);
      memcpy(line, dir, d);
      line[d] = '/';
      n = d + 1;
    }
  }
  size_t p = strnlen(path, PATH_MAX);
  memcpy(line + n, path, p);
  n += p;
  line[n++] = '\n';
  (void)write(log_fd, line, n);
}

static int my_open(const char *path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list ap;
    va_start(ap, flags);
    mode = (mode_t)va_arg(ap, int);
    va_end(ap);
  }
  int fd = open(path, flags, mode);
  note(AT_FDCWD, path);
  return fd;
}

static int my_openat(int dirfd, const char *path, int flags, ...) {
  mode_t mode = 0;
  if (flags & O_CREAT) {
    va_list ap;
    va_start(ap, flags);
    mode = (mode_t)va_arg(ap, int);
    va_end(ap);
  }
  int fd = openat(dirfd, path, flags, mode);
  note(dirfd, path);
  return fd;
}

__attribute__((used)) static const struct { const void *replacement; const void *replacee; } interposers[]
    __attribute__((section("__DATA,__interpose"))) = {
        { (const void *)my_open, (const void *)open },
        { (const void *)my_openat, (const void *)openat },
};
