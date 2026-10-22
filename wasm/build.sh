#!/bin/sh
# Compile the C compute core to WebAssembly with plain clang (no Emscripten, no libc).
set -e
cd "$(dirname "$0")"
if ! command -v clang >/dev/null 2>&1; then
  [ -f ../public/wasm/worldy.wasm ] && { echo "clang not found — using committed worldy.wasm"; exit 0; }
  echo "clang (with wasm32 target) is required to build wasm/" >&2; exit 1
fi
mkdir -p ../public/wasm
clang --target=wasm32 -O3 -nostdlib -ffreestanding -fno-builtin-memset \
  -Wall -Wextra -Wno-unused-parameter \
  -Wl,--no-entry -Wl,--import-undefined -Wl,--strip-all -Wl,--initial-memory=1048576 \
  -o ../public/wasm/worldy.wasm \
  memory.c geo.c sgp4.c terrain.c landslide.c tsunami.c flood.c terrain/geoid.c terrain/clean.c
echo "built public/wasm/worldy.wasm ($(wc -c < ../public/wasm/worldy.wasm) bytes)"

# Physics engine: separate module (own memory), SIMD enabled
clang --target=wasm32 -O3 -msimd128 -nostdlib -ffreestanding -fno-builtin-memset \
  -Wall -Wextra -Wno-unused-parameter \
  -Wl,--no-entry -Wl,--import-undefined -Wl,--strip-all -Wl,--initial-memory=4194304 \
  -o ../public/wasm/physics.wasm \
  memory.c sim/swe.c sim/edlts.c sim/hbg.c
echo "built public/wasm/physics.wasm ($(wc -c < ../public/wasm/physics.wasm) bytes)"
