// A hosted terminal's host process (#104, #989), shared by the macOS and Linux helpers, which include this file:
//
//   helper pty <dir> <cols> <rows> <protocol> <lock> <plants> <program> [<arg>...]
//
// It runs the program on a pseudo-terminal it holds, as the program's parent, and needs nobody attached: it outlives
// the hub and ends with the program. In <dir>, which the hub made owner-only:
//
// - `log`: the program's output, a ring of LOG_CAP bytes, and `checkpoint`: the screen, its scrollback and its modes
//   as JSON, written each time the ring wraps and when the program ends. The host feeds every byte to its own screen,
//   so a hub that reattaches draws the screen without replaying the log.
// - `sock`: the host's one way in. A connection is taken only from the process holding the hub's lock, <lock> (the
//   hub's SQLite file, whose fcntl lock names its holder's PID); any other is refused unread, and its PID is sent to
//   the hub as a notice to record. The host states <protocol> first on every connection it takes.
// - `pid`: the program's PID, once it runs.
//
// On the hub's connection, frames of a type byte, a 32-bit little-endian length and the payload:
//   hub → host  I <bytes>       input: queued whole, answered `i`, then written as the pseudo-terminal takes it
//               R <cols> <rows> a resize (two 16-bit little-endian numbers): the terminal's size and the screen's,
//                               answered `r`; the kernel signals the program (SIGWINCH)
//               S               the screen, answered `S` and the JSON a checkpoint holds
//               O               what the log holds, answered `O` and {"start","total"} in bytes of output
//   host → hub  H <json>        {"protocol","pid","cols","rows","key"}, first on each connection: the key is the one
//                               line the hub wrote to its stdin at start, so a hub talks only to the host it started
//               N <json>        {"pid"}: a writer refused
// Input waits in the queue while it's full (INPUT_CAP), so the hub's writes meet backpressure, and the host never
// blocks its output on its input. <plants> is `-` or a comma-separated list of #989's planted hosts.
#include <ctype.h>
#include <stdint.h>

#define LOG_CAP ((uint64_t)8 << 20)
#define HISTORY 1000
#define INPUT_CAP ((size_t)16 << 20)
#define CHUNK 65536

static int write_all(int fd, const char *buf, ssize_t n) {
  for (ssize_t done = 0; done < n;) {
    ssize_t w = write(fd, buf + done, (size_t)(n - done));
    if (w < 0 && errno == EINTR) continue;
    if (w < 0) return -1;
    done += w;
  }
  return 0;
}

typedef struct { char *p; size_t n, cap; } Buf;

static void put_bytes(Buf *b, const void *s, size_t n) {
  if (b->n + n > b->cap) {
    size_t cap = b->cap ? b->cap : 4096;
    while (cap < b->n + n) cap *= 2;
    char *p = realloc(b->p, cap);
    if (!p) abort();
    b->p = p;
    b->cap = cap;
  }
  memcpy(b->p + b->n, s, n);
  b->n += n;
}
static void put_str(Buf *b, const char *s) { put_bytes(b, s, strlen(s)); }
static void put_fmt(Buf *b, const char *fmt, long long v) {
  char tmp[64];
  int n = snprintf(tmp, sizeof tmp, fmt, v);
  put_bytes(b, tmp, (size_t)n);
}
static void put_utf8(Buf *b, uint32_t c) {
  char u[4];
  if (c < 0x80) { u[0] = (char)c; put_bytes(b, u, 1); }
  else if (c < 0x800) { u[0] = (char)(0xc0 | c >> 6); u[1] = (char)(0x80 | (c & 0x3f)); put_bytes(b, u, 2); }
  else if (c < 0x10000) { u[0] = (char)(0xe0 | c >> 12); u[1] = (char)(0x80 | (c >> 6 & 0x3f)); u[2] = (char)(0x80 | (c & 0x3f)); put_bytes(b, u, 3); }
  else { u[0] = (char)(0xf0 | c >> 18); u[1] = (char)(0x80 | (c >> 12 & 0x3f)); u[2] = (char)(0x80 | (c >> 6 & 0x3f)); u[3] = (char)(0x80 | (c & 0x3f)); put_bytes(b, u, 4); }
}

// ---- The screen: the program's output applied as a terminal draws it, text only.

/** The DEC private modes a checkpoint keeps: cursor keys, autowrap, the cursor shown, focus, mouse, bracketed paste. */
static const int MODES[] = { 1, 7, 25, 1000, 1002, 1003, 1004, 1006, 2004 };
enum { NMODES = sizeof MODES / sizeof *MODES, WRAP = 1, SHOWN = 2 };

typedef struct {
  uint32_t *cells;
  int x, y, pending;
} Grid;

typedef struct {
  int cols, rows, top, bottom;
  Grid main, alt, *on;
  int saved_x, saved_y;
  char modes[NMODES];
  char *history[HISTORY];
  int history_head, history_len;
  // The parser between bytes, so an escape split across reads reads as one.
  int state, params[16], nparams, private_;
  uint32_t utf8;
  int utf8_left;
  int drop_bottom;
} Screen;

enum { GROUND, ESCAPE, ESCAPE_INTER, CSI, OSC, OSC_ESCAPE };

static uint32_t *cell(Screen *s, int x, int y) { return &s->on->cells[(size_t)y * s->cols + x]; }
static void blank(uint32_t *c, size_t n) { for (size_t i = 0; i < n; i++) c[i] = ' '; }

static char *row_text(const uint32_t *row, int cols) {
  int end = cols;
  while (end > 0 && row[end - 1] == ' ') end--;
  Buf b = { 0 };
  for (int x = 0; x < end; x++) put_utf8(&b, row[x]);
  put_bytes(&b, "", 1);
  return b.p;
}
static void keep_row(Screen *s, const uint32_t *row) {
  int at = (s->history_head + s->history_len) % HISTORY;
  if (s->history_len == HISTORY) {
    free(s->history[s->history_head]);
    s->history_head = (s->history_head + 1) % HISTORY;
    at = (s->history_head + s->history_len - 1) % HISTORY;
  } else s->history_len++;
  s->history[at] = row_text(row, s->cols);
}

static void screen_init(Screen *s, int cols, int rows, int drop_bottom) {
  memset(s, 0, sizeof *s);
  s->cols = cols;
  s->rows = rows;
  s->bottom = rows - 1;
  s->main.cells = malloc(sizeof(uint32_t) * (size_t)cols * rows);
  s->alt.cells = malloc(sizeof(uint32_t) * (size_t)cols * rows);
  if (!s->main.cells || !s->alt.cells) abort();
  blank(s->main.cells, (size_t)cols * rows);
  blank(s->alt.cells, (size_t)cols * rows);
  s->on = &s->main;
  s->modes[WRAP] = s->modes[SHOWN] = 1;
  s->drop_bottom = drop_bottom;
}

/** Scrolls rows top..bottom up by n; rows leaving the top of the main screen go to the scrollback. */
static void scroll_up(Screen *s, int top, int bottom, int n) {
  if (n > bottom - top + 1) n = bottom - top + 1;
  for (int i = 0; i < n; i++) {
    if (s->on == &s->main && top == 0) keep_row(s, cell(s, 0, top));
    memmove(cell(s, 0, top), cell(s, 0, top + 1), sizeof(uint32_t) * (size_t)s->cols * (bottom - top));
    blank(cell(s, 0, bottom), (size_t)s->cols);
  }
}
static void scroll_down(Screen *s, int top, int bottom, int n) {
  if (n > bottom - top + 1) n = bottom - top + 1;
  for (int i = 0; i < n; i++) {
    memmove(cell(s, 0, top + 1), cell(s, 0, top), sizeof(uint32_t) * (size_t)s->cols * (bottom - top));
    blank(cell(s, 0, top), (size_t)s->cols);
  }
}
static void line_feed(Screen *s) {
  Grid *g = s->on;
  g->pending = 0;
  if (g->y == s->bottom) scroll_up(s, s->top, s->bottom, 1);
  else if (g->y < s->rows - 1) g->y++;
}
static void put_char(Screen *s, uint32_t c) {
  Grid *g = s->on;
  if (g->pending && s->modes[WRAP]) { g->x = 0; line_feed(s); }
  *cell(s, g->x, g->y) = c;
  if (g->x == s->cols - 1) g->pending = s->modes[WRAP];
  else g->x++;
}
static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }
static void move_to(Screen *s, int x, int y) {
  s->on->x = clampi(x, 0, s->cols - 1);
  s->on->y = clampi(y, 0, s->rows - 1);
  s->on->pending = 0;
}
static void erase(Screen *s, int x0, int y0, int x1, int y1) {
  // Every cell from (x0, y0) up to, not including, (x1, y1), in reading order.
  size_t from = (size_t)y0 * s->cols + x0, to = (size_t)y1 * s->cols + x1;
  if (to > from) blank(s->on->cells + from, to - from);
}
static void set_mode(Screen *s, int mode, int on) {
  if (mode == 1049 || mode == 1047 || mode == 47) {
    if (on && s->on == &s->main) {
      if (mode == 1049) { s->saved_x = s->main.x; s->saved_y = s->main.y; }
      blank(s->alt.cells, (size_t)s->cols * s->rows);
      s->alt.x = s->main.x;
      s->alt.y = s->main.y;
      s->alt.pending = 0;
      s->on = &s->alt;
    } else if (!on && s->on == &s->alt) {
      s->on = &s->main;
      if (mode == 1049) move_to(s, s->saved_x, s->saved_y);
    }
    return;
  }
  for (int i = 0; i < NMODES; i++) if (MODES[i] == mode) s->modes[i] = (char)on;
}
static int param(Screen *s, int i, int fallback) { return i < s->nparams && s->params[i] > 0 ? s->params[i] : fallback; }

static void csi(Screen *s, unsigned char f) {
  Grid *g = s->on;
  int n = param(s, 0, 1);
  if (s->private_ == '?') {
    if (f == 'h' || f == 'l') for (int i = 0; i < s->nparams; i++) set_mode(s, s->params[i], f == 'h');
    return;
  }
  if (s->private_) return;
  switch (f) {
    case 'A': move_to(s, g->x, g->y - n); break;
    case 'B': case 'e': move_to(s, g->x, g->y + n); break;
    case 'C': case 'a': move_to(s, g->x + n, g->y); break;
    case 'D': move_to(s, g->x - n, g->y); break;
    case 'E': move_to(s, 0, g->y + n); break;
    case 'F': move_to(s, 0, g->y - n); break;
    case 'G': case '`': move_to(s, n - 1, g->y); break;
    case 'd': move_to(s, g->x, n - 1); break;
    case 'H': case 'f': move_to(s, param(s, 1, 1) - 1, n - 1); break;
    case 'J': {
      int how = param(s, 0, 0);
      if (how == 0) erase(s, g->x, g->y, 0, s->rows);
      else if (how == 1) erase(s, 0, 0, g->x + 1, g->y);
      else if (how == 2) erase(s, 0, 0, 0, s->rows);
      if (how == 3) {
        for (int i = 0; i < s->history_len; i++) free(s->history[(s->history_head + i) % HISTORY]);
        s->history_head = s->history_len = 0;
      }
      break;
    }
    case 'K': {
      int how = param(s, 0, 0);
      uint32_t *row = cell(s, 0, g->y);
      if (how == 0) blank(row + g->x, (size_t)(s->cols - g->x));
      else if (how == 1) blank(row, (size_t)(g->x + 1));
      else blank(row, (size_t)s->cols);
      break;
    }
    case 'L': if (g->y >= s->top && g->y <= s->bottom) scroll_down(s, g->y, s->bottom, n); break;
    case 'M': // deleted lines never reach the scrollback
      if (g->y >= s->top && g->y <= s->bottom) {
        if (n > s->bottom - g->y + 1) n = s->bottom - g->y + 1;
        memmove(cell(s, 0, g->y), cell(s, 0, g->y + n), sizeof(uint32_t) * (size_t)s->cols * (s->bottom - g->y + 1 - n));
        blank(cell(s, 0, s->bottom - n + 1), (size_t)s->cols * n);
      }
      break;
    case 'P': {
      uint32_t *row = cell(s, 0, g->y);
      if (n > s->cols - g->x) n = s->cols - g->x;
      memmove(row + g->x, row + g->x + n, sizeof(uint32_t) * (size_t)(s->cols - g->x - n));
      blank(row + s->cols - n, (size_t)n);
      break;
    }
    case '@': {
      uint32_t *row = cell(s, 0, g->y);
      if (n > s->cols - g->x) n = s->cols - g->x;
      memmove(row + g->x + n, row + g->x, sizeof(uint32_t) * (size_t)(s->cols - g->x - n));
      blank(row + g->x, (size_t)n);
      break;
    }
    case 'X': blank(cell(s, g->x, g->y), (size_t)(n < s->cols - g->x ? n : s->cols - g->x)); break;
    case 'S': scroll_up(s, s->top, s->bottom, n); break;
    case 'T': scroll_down(s, s->top, s->bottom, n); break;
    case 'r': {
      int top = param(s, 0, 1) - 1, bottom = param(s, 1, s->rows) - 1;
      if (top < bottom && bottom < s->rows) { s->top = top; s->bottom = bottom; move_to(s, 0, 0); }
      break;
    }
    case 's': s->saved_x = g->x; s->saved_y = g->y; break;
    case 'u': move_to(s, s->saved_x, s->saved_y); break;
    default: break; // colors and queries: the host never answers the program
  }
}

static void feed(Screen *s, const unsigned char *p, size_t n) {
  for (size_t i = 0; i < n; i++) {
    unsigned char b = p[i];
    switch (s->state) {
      case ESCAPE:
        s->state = GROUND;
        if (b == '[') { s->state = CSI; s->nparams = 0; s->private_ = 0; memset(s->params, 0, sizeof s->params); }
        else if (b == ']' || b == 'P' || b == '_' || b == '^' || b == 'X') s->state = OSC;
        else if (b == '(' || b == ')' || b == '*' || b == '+' || b == '#' || b == '%') s->state = ESCAPE_INTER;
        else if (b == '7') { s->saved_x = s->on->x; s->saved_y = s->on->y; }
        else if (b == '8') move_to(s, s->saved_x, s->saved_y);
        else if (b == 'D') line_feed(s);
        else if (b == 'E') { s->on->x = 0; line_feed(s); }
        else if (b == 'M') {
          if (s->on->y == s->top) scroll_down(s, s->top, s->bottom, 1);
          else move_to(s, s->on->x, s->on->y - 1);
        } else if (b == 'c') {
          blank(s->main.cells, (size_t)s->cols * s->rows);
          s->on = &s->main;
          s->top = 0;
          s->bottom = s->rows - 1;
          move_to(s, 0, 0);
        }
        continue;
      case ESCAPE_INTER: s->state = GROUND; continue;
      case CSI:
        if (b >= '0' && b <= '9') {
          if (s->nparams == 0) s->nparams = 1;
          int *v = &s->params[s->nparams - 1];
          if (*v < 100000) *v = *v * 10 + (b - '0');
        } else if (b == ';' || b == ':') { if (s->nparams == 0) s->nparams = 1; if (s->nparams < 16) s->nparams++; }
        else if (b >= 0x3c && b <= 0x3f) s->private_ = b;
        else if (b >= 0x40 && b <= 0x7e) { s->state = GROUND; csi(s, b); }
        else if (b == 0x1b) s->state = ESCAPE;
        else if (b < 0x20) goto control;
        continue;
      case OSC:
        if (b == 0x07) s->state = GROUND;
        else if (b == 0x1b) s->state = OSC_ESCAPE;
        continue;
      case OSC_ESCAPE: s->state = b == '\\' ? GROUND : OSC; continue;
      default: break;
    }
    if (s->utf8_left) {
      if ((b & 0xc0) == 0x80) {
        s->utf8 = s->utf8 << 6 | (b & 0x3f);
        if (--s->utf8_left == 0) put_char(s, s->utf8);
        continue;
      }
      s->utf8_left = 0;
      put_char(s, 0xfffd);
    }
    if (b >= 0xc0 && b < 0xf8) { s->utf8_left = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : 1; s->utf8 = b & (0x3f >> s->utf8_left); continue; }
    if (b >= 0x80) { put_char(s, 0xfffd); continue; }
    if (b >= 0x20 && b != 0x7f) { put_char(s, b); continue; }
  control:
    switch (b) {
      case '\r': s->on->x = 0; s->on->pending = 0; break;
      case '\n': case 0x0b: case 0x0c: line_feed(s); break;
      case '\b': if (s->on->x > 0) s->on->x--; s->on->pending = 0; break;
      case '\t': move_to(s, (s->on->x / 8 + 1) * 8, s->on->y); break;
      case 0x1b: s->state = ESCAPE; break;
      default: break;
    }
  }
}

/** A new size: a shrink keeps the bottom rows and the cursor, where the newest output is, and moves the rows above into the scrollback. */
static void screen_resize(Screen *s, int cols, int rows) {
  Grid *grids[2] = { &s->main, &s->alt };
  for (int k = 0; k < 2; k++) {
    Grid *g = grids[k];
    int shift = s->drop_bottom ? 0 : g->y - (rows - 1);
    if (shift < 0) shift = 0;
    if (g == &s->main) {
      Grid *was = s->on;
      s->on = g;
      for (int y = 0; y < shift; y++) keep_row(s, cell(s, 0, y));
      s->on = was;
    }
    uint32_t *cells = malloc(sizeof(uint32_t) * (size_t)cols * rows);
    if (!cells) abort();
    blank(cells, (size_t)cols * rows);
    for (int y = 0; y < rows && y + shift < s->rows; y++) memcpy(cells + (size_t)y * cols, g->cells + (size_t)(y + shift) * s->cols, sizeof(uint32_t) * (size_t)(cols < s->cols ? cols : s->cols));
    free(g->cells);
    g->cells = cells;
    g->y = clampi(g->y - shift, 0, rows - 1);
    g->x = clampi(g->x, 0, cols - 1);
    g->pending = 0;
  }
  s->cols = cols;
  s->rows = rows;
  s->top = 0;
  s->bottom = rows - 1;
}

static void put_json_text(Buf *b, const char *t) {
  put_bytes(b, "\"", 1);
  for (const unsigned char *c = (const unsigned char *)t; *c; c++) {
    if (*c == '"' || *c == '\\') { put_bytes(b, "\\", 1); put_bytes(b, c, 1); }
    else if (*c < 0x20) put_fmt(b, "\\u%04llx", *c);
    else put_bytes(b, c, 1);
  }
  put_bytes(b, "\"", 1);
}
/** The screen as JSON: its size, the cursor, its rows and the scrollback as text, and its modes. */
static void screen_json(Screen *s, Buf *b, uint64_t total) {
  put_fmt(b, "{\"cols\":%lld", s->cols);
  put_fmt(b, ",\"rows\":%lld", s->rows);
  put_fmt(b, ",\"cursor\":{\"row\":%lld", s->on->y);
  put_fmt(b, ",\"col\":%lld},\"screen\":[", s->on->pending ? s->cols - 1 : s->on->x);
  for (int y = 0; y < s->rows; y++) {
    char *t = row_text(s->on->cells + (size_t)y * s->cols, s->cols);
    if (y) put_str(b, ",");
    put_json_text(b, t);
    free(t);
  }
  put_str(b, "],\"scrollback\":[");
  for (int i = 0; i < s->history_len; i++) {
    if (i) put_str(b, ",");
    put_json_text(b, s->history[(s->history_head + i) % HISTORY]);
  }
  put_str(b, "],\"modes\":[");
  int first = 1;
  if (s->on == &s->alt) { put_str(b, "1049"); first = 0; }
  for (int i = 0; i < NMODES; i++) if (s->modes[i]) { if (!first) put_str(b, ","); put_fmt(b, "%lld", MODES[i]); first = 0; }
  put_fmt(b, "],\"total\":%lld}", (long long)total);
}

// ---- The host.

typedef struct {
  const char *dir, *lock;
  int protocol, master, log, listener, fifo, hub;
  pid_t child;
  uint64_t total;
  Screen screen;
  // The hub's connection: the frame being read and what waits to be written to it.
  unsigned char head[5];
  size_t head_n;
  Buf frame, out;
  // Input taken, waiting for the pseudo-terminal.
  Buf queue;
  size_t queued_from;
  // Writers refused while no hub was connected, sent once one is; and the last ones sent, each named once.
  pid_t refused[64], named[64];
  int nrefused, nnamed;
  // What the hub gave it at start, which it states to every hub it takes, so a hub knows its own host.
  char key[129];
  // How much input waits before it stops reading the hub: INPUT_CAP, or a pipe's 64 KiB for the planted hub that throws.
  size_t room;
  int keeps_start_size, uncapped, input_blocks;
} Host;

static int planted(const char *plants, const char *name) {
  size_t n = strlen(name);
  for (const char *p = plants; (p = strstr(p, name)); p += n) {
    if ((p == plants || p[-1] == ',') && (p[n] == 0 || p[n] == ',')) return 1;
  }
  return 0;
}

static void send_frame(Host *h, char type, const Buf *body) {
  if (h->hub < 0) return;
  uint32_t n = body ? (uint32_t)body->n : 0;
  unsigned char head[5] = { (unsigned char)type, (unsigned char)n, (unsigned char)(n >> 8), (unsigned char)(n >> 16), (unsigned char)(n >> 24) };
  put_bytes(&h->out, head, 5);
  if (n) put_bytes(&h->out, body->p, n);
}
static void notice(Host *h, pid_t pid) {
  // Bounded: a writer that keeps trying is named once, and a hub that stops reading gets no more.
  for (int i = 0; i < h->nnamed && i < 64; i++) if (h->named[i] == pid) return;
  if (h->out.n > CHUNK * 16) return;
  h->named[h->nnamed++ % 64] = pid;
  Buf b = { 0 };
  put_fmt(&b, "{\"pid\":%lld}", pid);
  send_frame(h, 'N', &b);
  free(b.p);
}

static void write_checkpoint(Host *h) {
  char tmp[PATH_MAX], path[PATH_MAX];
  snprintf(tmp, sizeof tmp, "%s/checkpoint.tmp", h->dir);
  snprintf(path, sizeof path, "%s/checkpoint", h->dir);
  Buf b = { 0 };
  screen_json(&h->screen, &b, h->total);
  int fd = open(tmp, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
  if (fd >= 0) {
    int ok = write_all(fd, b.p, (ssize_t)b.n) == 0;
    if (close(fd) == 0 && ok) rename(tmp, path);
  }
  free(b.p);
}

/** The program's output: into the ring (a checkpoint each time it wraps) and onto the screen. */
static int output(Host *h, const unsigned char *buf, size_t n) {
  feed(&h->screen, buf, n);
  uint64_t before = h->total;
  if (h->uncapped) {
    if (write_all(h->log, (const char *)buf, (ssize_t)n) != 0) return -1;
  } else {
    for (size_t done = 0; done < n;) {
      uint64_t at = (h->total + done) % LOG_CAP;
      size_t room = (size_t)(LOG_CAP - at), part = n - done < room ? n - done : room;
      ssize_t w = pwrite(h->log, buf + done, part, (off_t)at);
      if (w < 0 && errno == EINTR) continue;
      if (w <= 0) return -1;
      done += (size_t)w;
    }
  }
  h->total += n;
  if (before / LOG_CAP != h->total / LOG_CAP) write_checkpoint(h);
  return 0;
}

static pid_t peer_pid(int fd) {
#ifdef __linux__
  struct ucred c;
  socklen_t n = sizeof c;
  return getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &c, &n) == 0 ? c.pid : -1;
#else
  pid_t p;
  socklen_t n = sizeof p;
  return getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &p, &n) == 0 ? p : -1;
#endif
}
/** The process holding the hub's lock: SQLite's exclusive lock is an fcntl write lock on its lock bytes, from 1 GiB. */
static pid_t lock_holder(const char *path) {
  int fd = open(path, O_RDONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  struct flock l = { .l_type = F_WRLCK, .l_whence = SEEK_SET, .l_start = 0x40000000, .l_len = 512 };
  int rc = fcntl(fd, F_GETLK, &l);
  close(fd);
  // A read lock is any reader's: only the hub's exclusive transaction holds a write lock there.
  return rc == 0 && l.l_type == F_WRLCK ? l.l_pid : -1;
}

/** The hub's connection goes: a checkpoint keeps the screen it left, for the next hub to show. */
static void hub_drop(Host *h) {
  if (h->hub >= 0) {
    close(h->hub);
    write_checkpoint(h);
  }
  h->hub = -1;
  h->head_n = 0;
  h->frame.n = h->out.n = 0;
}

static void accept_one(Host *h) {
  int fd = accept(h->listener, NULL, NULL);
  if (fd < 0) return;
  fcntl(fd, F_SETFD, FD_CLOEXEC);
  pid_t pid = peer_pid(fd);
  if (pid <= 0 || pid != lock_holder(h->lock)) {
    // Refused unread: nothing it wrote reaches the program.
    close(fd);
    if (h->hub >= 0) notice(h, pid);
    else {
      for (int i = 0; i < h->nrefused; i++) if (h->refused[i] == pid) return;
      if (h->nrefused < (int)(sizeof h->refused / sizeof *h->refused)) h->refused[h->nrefused++] = pid;
    }
    return;
  }
  hub_drop(h);
  h->hub = fd;
  fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
  Buf b = { 0 };
  put_fmt(&b, "{\"protocol\":%lld", h->protocol);
  put_fmt(&b, ",\"pid\":%lld", h->child);
  put_fmt(&b, ",\"cols\":%lld", h->screen.cols);
  put_fmt(&b, ",\"rows\":%lld", h->screen.rows);
  put_str(&b, ",\"key\":\"");
  put_str(&b, h->key);
  put_str(&b, "\"}");
  send_frame(h, 'H', &b);
  free(b.p);
  for (int i = 0; i < h->nrefused; i++) notice(h, h->refused[i]);
  h->nrefused = 0;
}

static void enqueue(Host *h, const void *p, size_t n) {
  // What the terminal took goes, so the queue holds only what waits.
  if (h->queued_from) {
    memmove(h->queue.p, h->queue.p + h->queued_from, h->queue.n - h->queued_from);
    h->queue.n -= h->queued_from;
    h->queued_from = 0;
  }
  put_bytes(&h->queue, p, n);
}

static void hub_call(Host *h, unsigned char type, const Buf *body) {
  Buf b = { 0 };
  if (type == 'I') {
    enqueue(h, body->p, body->n);
    send_frame(h, 'i', NULL);
  } else if (type == 'R' && body->n == 4) {
    int cols = (body->p[0] & 0xff) | (body->p[1] & 0xff) << 8, rows = (body->p[2] & 0xff) | (body->p[3] & 0xff) << 8;
    if (cols >= 1 && rows >= 1 && cols <= 1000 && rows <= 1000) {
      screen_resize(&h->screen, cols, rows);
      struct winsize size = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols };
      // The planted host signals the program and leaves its terminal at the start size.
      if (h->keeps_start_size) kill(-h->child, SIGWINCH);
      else ioctl(h->master, TIOCSWINSZ, &size);
    }
    send_frame(h, 'r', NULL);
  } else if (type == 'S') {
    screen_json(&h->screen, &b, h->total);
    send_frame(h, 'S', &b);
  } else if (type == 'O') {
    put_fmt(&b, "{\"start\":%lld", (long long)(h->uncapped || h->total < LOG_CAP ? 0 : h->total - LOG_CAP));
    put_fmt(&b, ",\"total\":%lld}", (long long)h->total);
    send_frame(h, 'O', &b);
  } else hub_drop(h);
  free(b.p);
}

/** Reads what the hub sent, frame by frame, while the input queue has room. */
static void from_hub(Host *h) {
  static unsigned char buf[CHUNK];
  ssize_t n = read(h->hub, buf, sizeof buf);
  if (n < 0 && (errno == EINTR || errno == EAGAIN)) return;
  if (n <= 0) { hub_drop(h); return; }
  for (ssize_t i = 0; h->hub >= 0;) {
    if (h->head_n < 5) {
      if (i == n) break;
      h->head[h->head_n++] = buf[i++];
      continue;
    }
    size_t want = (size_t)h->head[1] | (size_t)h->head[2] << 8 | (size_t)h->head[3] << 16 | (size_t)h->head[4] << 24;
    if (want > INPUT_CAP) { hub_drop(h); return; }
    size_t part = (size_t)(n - i) < want - h->frame.n ? (size_t)(n - i) : want - h->frame.n;
    put_bytes(&h->frame, buf + i, part);
    i += (ssize_t)part;
    if (h->frame.n < want) break;
    hub_call(h, h->head[0], &h->frame);
    h->head_n = 0;
    h->frame.n = 0;
  }
}

static int host(const char *dir, int cols, int rows, int protocol, const char *lock, const char *plants, char **argv) {
  Host h = { .dir = dir, .lock = lock, .protocol = protocol, .fifo = -1, .hub = -1 };
  if (cols < 1 || rows < 1 || cols > 1000 || rows > 1000) { fprintf(stderr, "a terminal's size is 1 to 1000 columns and rows, not %dx%d\n", cols, rows); return 2; }
  h.keeps_start_size = planted(plants, "keeps-start-size");
  h.uncapped = planted(plants, "replays-from-first-byte");
  h.input_blocks = planted(plants, "input-blocks-output");
  h.room = planted(plants, "hub-throws-when-full") ? 65536 : INPUT_CAP;
  // Its key, one line on stdin from the hub that starts it.
  size_t got = 0;
  for (char c; got < sizeof h.key - 1 && read(0, &c, 1) == 1 && c != '\n';) if (isxdigit((unsigned char)c)) h.key[got++] = c;
  screen_init(&h.screen, cols, rows, planted(plants, "resize-drops-bottom-rows"));
  // Nobody may be reading what it was started with: the hub that started it can be gone.
  signal(SIGPIPE, SIG_IGN);
  signal(SIGHUP, SIG_IGN);
  // Its files and its way in first, so a program never starts with nothing to hold it. Each is the owner's alone.
  mode_t mask = umask(0177);
  char path[PATH_MAX], note[PATH_MAX];
  snprintf(path, sizeof path, "%s/log", dir);
  h.log = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC | (h.uncapped ? O_APPEND : 0), 0600);
  struct sockaddr_un addr = { .sun_family = AF_UNIX };
  if (snprintf(addr.sun_path, sizeof addr.sun_path, "%s/sock", dir) >= (int)sizeof addr.sun_path) { fprintf(stderr, "%s/sock: the path is too long for a socket\n", dir); return 2; }
  unlink(addr.sun_path);
  h.listener = socket(AF_UNIX, SOCK_STREAM, 0);
  if (h.log < 0 || h.listener < 0 || bind(h.listener, (struct sockaddr *)&addr, sizeof addr) != 0 || listen(h.listener, 16) != 0) { perror(dir); return 2; }
  fcntl(h.listener, F_SETFD, FD_CLOEXEC);
  if (planted(plants, "input-through-fifo")) {
    snprintf(path, sizeof path, "%s/in", dir);
    if (mkfifo(path, 0600) == 0) h.fifo = open(path, O_RDWR | O_NONBLOCK | O_CLOEXEC);
  }
  struct winsize size = { .ws_row = (unsigned short)rows, .ws_col = (unsigned short)cols };
  h.child = forkpty(&h.master, NULL, NULL, &size);
  if (h.child < 0) { perror("forkpty"); unlink(addr.sun_path); return 2; }
  if (h.child == 0) {
    umask(mask);
    signal(SIGPIPE, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    execvp(argv[0], argv);
    perror(argv[0]);
    _exit(127);
  }
  fcntl(h.master, F_SETFD, FD_CLOEXEC);
  fcntl(h.master, F_SETFL, fcntl(h.master, F_GETFL) | O_NONBLOCK);
  snprintf(note, sizeof note, "%s/pid.tmp", dir);
  snprintf(path, sizeof path, "%s/pid", dir);
  FILE *pid = fopen(note, "w");
  if (!pid || fprintf(pid, "%d", h.child) < 0 || fclose(pid) != 0 || rename(note, path) != 0) { perror(note); return 2; }
  static unsigned char buf[CHUNK];
  // select, not poll: macOS's poll doesn't take a terminal device.
  for (;;) {
    size_t waiting = h.queue.n - h.queued_from;
    fd_set rd, wr;
    FD_ZERO(&rd);
    FD_ZERO(&wr);
    FD_SET(h.master, &rd);
    FD_SET(h.listener, &rd);
    int top = h.master > h.listener ? h.master : h.listener;
    if (waiting) FD_SET(h.master, &wr);
    if (h.hub >= 0) {
      if (waiting < h.room) FD_SET(h.hub, &rd);
      if (h.out.n) FD_SET(h.hub, &wr);
      if (h.hub > top) top = h.hub;
    }
    if (h.fifo >= 0) { FD_SET(h.fifo, &rd); if (h.fifo > top) top = h.fifo; }
    if (select(top + 1, &rd, &wr, NULL, NULL) < 0) {
      if (errno == EINTR) continue;
      break;
    }
    if (FD_ISSET(h.master, &rd)) {
      ssize_t n = read(h.master, buf, sizeof buf);
      // The program and everything holding its terminal are gone.
      if (n == 0 || (n < 0 && errno != EINTR && errno != EAGAIN)) break;
      if (n > 0 && output(&h, buf, (size_t)n) != 0) break;
    }
    if (waiting && FD_ISSET(h.master, &wr)) {
      if (h.input_blocks) {
        // The planted host: the whole queue in one blocking write, its output unread until the program takes it all.
        fcntl(h.master, F_SETFL, fcntl(h.master, F_GETFL) & ~O_NONBLOCK);
        if (write_all(h.master, h.queue.p + h.queued_from, (ssize_t)waiting) != 0) break;
        fcntl(h.master, F_SETFL, fcntl(h.master, F_GETFL) | O_NONBLOCK);
        h.queued_from += waiting;
      } else {
        ssize_t w = write(h.master, h.queue.p + h.queued_from, waiting < CHUNK ? waiting : CHUNK);
        if (w > 0) h.queued_from += (size_t)w;
        else if (w < 0 && errno != EINTR && errno != EAGAIN) break;
      }
      if (h.queued_from == h.queue.n) h.queue.n = h.queued_from = 0;
    }
    if (FD_ISSET(h.listener, &rd)) accept_one(&h);
    if (h.fifo >= 0 && FD_ISSET(h.fifo, &rd)) {
      ssize_t n = read(h.fifo, buf, sizeof buf);
      if (n > 0) enqueue(&h, buf, (size_t)n);
    }
    if (h.hub >= 0 && FD_ISSET(h.hub, &rd)) from_hub(&h);
    if (h.hub >= 0 && h.out.n && FD_ISSET(h.hub, &wr)) {
      ssize_t w = write(h.hub, h.out.p, h.out.n);
      if (w > 0) { memmove(h.out.p, h.out.p + w, h.out.n - (size_t)w); h.out.n -= (size_t)w; }
      else if (w < 0 && errno != EINTR && errno != EAGAIN) hub_drop(&h);
    }
  }
  // The last screen stays for a hub to show the session ended; the way in goes.
  write_checkpoint(&h);
  unlink(addr.sun_path);
  int status = 0;
  waitpid(h.child, &status, 0);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
