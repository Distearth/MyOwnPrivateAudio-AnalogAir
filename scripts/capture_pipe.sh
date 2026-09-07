#!/bin/bash
# ==============================================================================
# AnalogAir - Glitch-Free Audio Capture Pipe Broker
# Streams turntable audio (16-bit 44.1kHz stereo) into FIFO pipe for OwnTone.
# ==============================================================================
MUSIC_DIR="${1:-$HOME/Music/AnalogAir}"
PIPE="$MUSIC_DIR/AnalogAir"
mkdir -p "$MUSIC_DIR"
[ -p "$PIPE" ] || mkfifo "$PIPE"

echo "[AnalogAir Capture] Streaming turntable audio into FIFO pipe: $PIPE"

# 1. PipeWire pw-cat
if command -v pw-cat >/dev/null 2>&1; then
    TARGET=""
    DEV=$(sqlite3 "$HOME/.config/analogair/settings.db" "SELECT value FROM settings WHERE key='audio_device';" 2>/dev/null || echo "")
    if [ -n "$DEV" ] && [ "$DEV" != "@DEFAULT_SOURCE@" ] && [ "$DEV" != "default" ]; then
        TARGET="--target=$DEV"
    fi
    exec pw-cat --record $TARGET --format=s16 --rate=44100 --channels=2 --raw - > "$PIPE"
fi

# 2. ALSA arecord fallback
if command -v arecord >/dev/null 2>&1; then
    ALSA_CARD=$(arecord -l 2>/dev/null | grep -i -E "usb|codec|audio|turntable" | head -n1 | sed -n 's/card \([0-9]\+\):.*/\1/p')
    ALSA_DEV="default"
    if [ -n "$ALSA_CARD" ]; then
        ALSA_DEV="plughw:$ALSA_CARD,0"
    fi
    exec arecord -q -D "$ALSA_DEV" -f S16_LE -r 44100 -c 2 > "$PIPE"
fi

# 3. ffmpeg fallback
if command -v ffmpeg >/dev/null 2>&1; then
    exec ffmpeg -loglevel error -f pulse -i default -f s16le -ar 44100 -ac 2 - > "$PIPE"
fi

echo "[AnalogAir Capture] Error: No audio capture utility found (pw-cat, arecord, ffmpeg)."
exit 1
