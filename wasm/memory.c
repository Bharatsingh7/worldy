/*
 * Bump allocator over wasm linear memory.
 *   walloc(n)     — 8-byte aligned block, grows memory as needed
 *   wmark()       — current top, to release everything allocated after it
 *   wrelease(m)   — pop back to a mark
 */
#include "worldy.h"

extern u8 __heap_base;
static u32 top = 0;

EXPORT(walloc) void *walloc(u32 bytes) {
  if (!top) top = (u32)&__heap_base;
  u32 start = (top + 7u) & ~7u;
  u32 end = start + bytes;
  u32 have = (u32)__builtin_wasm_memory_size(0) * 65536u;
  if (end > have) {
    u32 pages = (end - have + 65535u) / 65536u;
    if (__builtin_wasm_memory_grow(0, pages) == (unsigned long)-1) return 0;
  }
  top = end;
  return (void *)start;
}

EXPORT(wmark) u32 wmark(void) {
  if (!top) top = (u32)&__heap_base;
  return top;
}

EXPORT(wrelease) void wrelease(u32 mark) {
  top = mark;
}

/* ── Heap for priority sweeps ─────────────────────────── */

void heap_init(Heap *h, int capacity) {
  h->idx = (int *)walloc((u32)capacity * 4u);
  h->key = (double *)walloc((u32)capacity * 8u);
  h->size = 0;
}

void heap_push(Heap *h, int i, double k) {
  int c = h->size++;
  while (c > 0) {
    int p = (c - 1) >> 1;
    if (h->key[p] <= k) break;
    h->idx[c] = h->idx[p];
    h->key[c] = h->key[p];
    c = p;
  }
  h->idx[c] = i;
  h->key[c] = k;
}

int heap_pop(Heap *h, double *k) {
  int top_i = h->idx[0];
  *k = h->key[0];
  int last_i = h->idx[--h->size];
  double last_k = h->key[h->size];
  int c = 0;
  for (;;) {
    int l = 2 * c + 1;
    if (l >= h->size) break;
    int r = l + 1;
    int m = (r < h->size && h->key[r] < h->key[l]) ? r : l;
    if (h->key[m] >= last_k) break;
    h->idx[c] = h->idx[m];
    h->key[c] = h->key[m];
    c = m;
  }
  h->idx[c] = last_i;
  h->key[c] = last_k;
  return top_i;
}
