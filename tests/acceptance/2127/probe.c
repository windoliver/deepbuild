#define _GNU_SOURCE
#include <errno.h>
#include <linux/netlink.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

static union {
  struct sockaddr_in in;
  struct sockaddr_nl nl;
  unsigned char bytes[16];
} target;
static volatile int swapping = 1;

static void *swap_family(void *unused) {
  (void)unused;
  while (__atomic_load_n(&swapping, __ATOMIC_RELAXED)) {
    __atomic_store_n(&target.in.sin_family, (sa_family_t)AF_NETLINK, __ATOMIC_RELAXED);
    __atomic_store_n(&target.in.sin_family, (sa_family_t)AF_INET, __ATOMIC_RELAXED);
  }
  return NULL;
}

static FILE *open_out(const char *path) {
  FILE *out = fopen(path, "a");
  if (!out) { perror(path); exit(120); }
  return out;
}

static int race(const char *path, int port, int tries) {
  memset(&target, 0, sizeof target);
  target.in.sin_family = AF_NETLINK;
  target.in.sin_port = htons((unsigned short)port);
  target.in.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  pthread_t swapper;
  if (pthread_create(&swapper, NULL, swap_family, NULL) != 0) return 121;
  int connected = 0, refused = 0, other = 0, made = 0;
  for (int i = 0; i < tries; i++) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) { other++; continue; }
    made++;
    if (connect(s, (struct sockaddr *)&target, sizeof target) == 0) connected++;
    else if (errno == EACCES || errno == EPERM) refused++;
    else other++;
    close(s);
  }
  __atomic_store_n(&swapping, 0, __ATOMIC_RELAXED);
  pthread_join(swapper, NULL);
  FILE *out = open_out(path);
  fprintf(out, "{\"mode\":\"race\",\"tries\":%d,\"sockets\":%d,\"connected\":%d,\"refused\":%d,\"other\":%d}\n", tries, made, connected, refused, other);
  fclose(out);
  return 0;
}

static int x32(const char *path) {
  FILE *out = open_out(path);
  fprintf(out, "{\"mode\":\"x32\",\"calling\":true}\n");
  fclose(out);
  long rc = syscall(0x40000000 | SYS_getpid);
  int err = rc < 0 ? errno : 0;
  out = open_out(path);
  fprintf(out, "{\"mode\":\"x32\",\"returned\":%ld,\"errno\":%d}\n", rc, err);
  fclose(out);
  return 0;
}

static int listen_unbound(const char *path) {
  int s = socket(AF_INET, SOCK_STREAM, 0);
  int made = s >= 0;
  int rc = made ? listen(s, 1) : -1;
  int err = rc < 0 ? errno : 0;
  FILE *out = open_out(path);
  fprintf(out, "{\"mode\":\"listen\",\"socket\":%s,\"rc\":%d,\"errno\":%d}\n", made ? "true" : "false", rc, err);
  fclose(out);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 5 && strcmp(argv[1], "race") == 0) return race(argv[2], atoi(argv[3]), atoi(argv[4]));
  if (argc == 3 && strcmp(argv[1], "x32") == 0) return x32(argv[2]);
  if (argc == 3 && strcmp(argv[1], "listen") == 0) return listen_unbound(argv[2]);
  fprintf(stderr, "usage: probe race <file> <port> <tries> | x32 <file> | listen <file>\n");
  return 2;
}
