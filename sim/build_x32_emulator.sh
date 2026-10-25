#!/bin/bash
# Build Patrick-Gilles Maillot's X32 emulator (github.com/pmaillot/X32-Behringer), a full X32
# that X32-Edit, M32-Edit and this app can all connect to. Its source has no license, so it isn't
# copied into this repo: this downloads a fixed version into sim/x32-emulator/ (ignored by git)
# and builds it there.
#
# It reports firmware 4.13 instead of its built-in 4.06: X32-Edit 4.4 won't connect to 4.06.
#
#   sim/build_x32_emulator.sh
#   cd sim/x32-emulator && ./X32 -i <this Mac's IP>      (see README: "Behringer X32 / Midas M32")
set -euo pipefail

COMMIT=73870aa103bde6d7f5fe6898e837188b1107b3ea
BASE="https://raw.githubusercontent.com/pmaillot/X32-Behringer/$COMMIT"
DIR="$(cd "$(dirname "$0")" && pwd)/x32-emulator"

mkdir -p "$DIR"
cd "$DIR"
echo "Downloading the X32 emulator source ($COMMIT) into $DIR"
for f in X32.c X32Auxin.h X32Bus.h X32CfgMain.h X32Channel.h X32Dca.h X32Fx.h X32Fxrtn.h X32Headamp.h \
         X32Libs.h X32Misc.h X32Mtx.h X32Output.h X32PrefStat.h X32Show.h X32lib/Xsprint.c X32lib/Xdump.c; do
	curl -fsSL -o "$(basename "$f")" "$BASE/$f"
done

sed -i '' 's/#define XVERSION "4.06"/#define XVERSION "4.13"/' X32.c
cc -O1 -w -o X32 X32.c Xsprint.c Xdump.c -lm
echo "Built $DIR/X32. Run: cd \"$DIR\" && ./X32 -i <this Mac's IP address>"
