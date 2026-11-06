#!/usr/bin/env bash
# Builds whisper.cpp's whisper-cli (offline speech recognition, MIT licence)
# for Offox's automatic subtitles and downloads a speech model:
#
#   offox/installer/whisper/build-whisper.sh linux|windows <output folder>
#
# Output: <output folder>/whisper/
#   whisper-cli[.exe]          built for processors with AVX2 (2013 and newer)
#   whisper-cli-compat[.exe]   built without AVX, for older processors
#   models/ggml-base-q5_1.bin  multilingual speech model (~57 MB)
#   LICENSE, README.txt
# Offox looks for this folder next to its program (see findWhisper in
# browser/components/offox/modules/OffoxGecko.sys.mjs).
#
# linux: built in the manylinux_2_28 container (glibc 2.28, so it runs on
#        every current distribution) with libstdc++ linked in statically.
# windows: cross-compiled with MinGW-w64 (posix threads), linked statically.
# Set WHISPER_VERSION / WHISPER_MODEL to change what is fetched.
set -euo pipefail
PLATFORM="$1"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)/whisper"
VERSION="${WHISPER_VERSION:-1.9.5}"
MODEL="${WHISPER_MODEL:-ggml-base-q5_1.bin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" 2>/dev/null || sudo rm -rf "$WORK" 2>/dev/null || true' EXIT

fetch() { curl -fsSL --retry 5 --retry-delay 5 -o "$2" "$1"; }

echo "whisper.cpp $VERSION for $PLATFORM"
fetch "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$VERSION.tar.gz" "$WORK/src.tar.gz"
mkdir -p "$WORK/src" && tar -xzf "$WORK/src.tar.gz" -C "$WORK/src" --strip-components=1

COMMON=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF
  -DGGML_CCACHE=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF
  -DWHISPER_CURL=OFF -DWHISPER_FFMPEG=OFF)
AVX2=(-DGGML_SSE42=ON -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON -DGGML_BMI2=ON
  -DGGML_AVX512=OFF -DGGML_AVX_VNNI=OFF)
COMPAT=(-DGGML_SSE42=ON -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_BMI2=OFF
  -DGGML_AVX512=OFF -DGGML_AVX_VNNI=OFF)

mkdir -p "$OUT/models"
case "$PLATFORM" in
  linux)
    EXT=""
    cat > "$WORK/build.sh" <<'INNER'
set -euo pipefail
cd /src
for variant in avx2 compat; do
  if [ "$variant" = avx2 ]; then flags="$AVX2"; else flags="$COMPAT"; fi
  cmake -S . -B "build-$variant" $COMMON $flags \
    -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc" >/dev/null
  cmake --build "build-$variant" --target whisper-cli -j"$(nproc)"
done
INNER
    docker run --rm -v "$WORK/src:/src" -v "$WORK/build.sh:/build.sh:ro" \
      -e COMMON="${COMMON[*]}" -e AVX2="${AVX2[*]}" -e COMPAT="${COMPAT[*]}" \
      quay.io/pypa/manylinux_2_28_x86_64 bash /build.sh
    ;;
  windows)
    EXT=".exe"
    if ! command -v x86_64-w64-mingw32-g++-posix >/dev/null; then
      sudo apt-get install -y -q g++-mingw-w64-x86-64-posix gcc-mingw-w64-x86-64-posix >/dev/null
    fi
    for variant in avx2 compat; do
      if [ "$variant" = avx2 ]; then flags=("${AVX2[@]}"); else flags=("${COMPAT[@]}"); fi
      cmake -S "$WORK/src" -B "$WORK/src/build-$variant" "${COMMON[@]}" "${flags[@]}" \
        -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
        -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc-posix -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++-posix \
        -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres \
        -DCMAKE_FIND_ROOT_PATH=/usr/x86_64-w64-mingw32 \
        -DCMAKE_C_FLAGS="-include $HERE/mingw-compat.h" \
        -DCMAKE_EXE_LINKER_FLAGS="-static -static-libgcc -static-libstdc++" >/dev/null
      cmake --build "$WORK/src/build-$variant" --target whisper-cli -j"$(nproc)"
    done
    ;;
  *) echo "usage: $0 linux|windows <output folder>"; exit 2 ;;
esac

install -m755 "$WORK/src/build-avx2/bin/whisper-cli$EXT" "$OUT/whisper-cli$EXT"
install -m755 "$WORK/src/build-compat/bin/whisper-cli$EXT" "$OUT/whisper-cli-compat$EXT"
cp "$WORK/src/LICENSE" "$OUT/LICENSE"
cp "$WORK/src/samples/jfk.wav" "$(dirname "$OUT")/jfk.wav"
fetch "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL" "$OUT/models/$MODEL"
size=$(stat -c %s "$OUT/models/$MODEL")
[ "$size" -gt 20000000 ] || { echo "the model download is too small ($size bytes)"; exit 1; }
cat > "$OUT/README.txt" <<README
Offox automatic subtitles

whisper-cli is whisper.cpp $VERSION (https://github.com/ggml-org/whisper.cpp,
MIT licence, see LICENSE). Offox runs it to turn the speech of a video into
subtitles, on this computer and without the internet. whisper-cli-compat is
the same program for processors without AVX2.

models/$MODEL is the multilingual "base" Whisper model (MIT licence,
quantised by the whisper.cpp project). For more accurate subtitles, put a
bigger ggml model (for example ggml-small.bin, ggml-medium.bin or
ggml-large-v3-turbo.bin from https://huggingface.co/ggerganov/whisper.cpp)
into the models folder: Offox uses the most accurate one it finds, or the
one chosen in about:offox -> Automatic subtitles.
README
ls -la "$OUT" "$OUT/models"
file "$OUT"/whisper-cli* || true
