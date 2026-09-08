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

# Query Tone EQ, Preamp, and Audio Device settings from AnalogAir database
DB="$HOME/.config/analogair/settings.db"
BASS=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='bass_gain_db';" 2>/dev/null || echo "0")
MID=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='mid_gain_db';" 2>/dev/null || echo "0")
TREBLE=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='treble_gain_db';" 2>/dev/null || echo "0")
SELECTED_DEV=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='audio_device';" 2>/dev/null || echo "")

BASS="${BASS:-0}"
MID="${MID:-0}"
TREBLE="${TREBLE:-0}"

# Build real-time 3-band shelf equalizer filter graph (as in vinyl-airplay & professional audio DSP)
EQ_FILTER="bass=g=${BASS}:f=100,equalizer=f=1000:width_type=q:w=1:g=${MID},treble=g=${TREBLE}:f=8000"

echo "[AnalogAir Capture] Tone DSP Active: Bass=${BASS}dB, Mid=${MID}dB, Treble=${TREBLE}dB (Target Device: ${SELECTED_DEV:-Auto-Detect})"

# Determine ALSA and Pulse targets based on user selection or auto-detection
ALSA_DEV="default"
PULSE_DEV="default"

if [ -n "$SELECTED_DEV" ] && [ "$SELECTED_DEV" != "default" ] && [ "$SELECTED_DEV" != "@DEFAULT_SOURCE@" ]; then
    if [[ "$SELECTED_DEV" =~ ^hw: || "$SELECTED_DEV" =~ ^plughw: ]]; then
        ALSA_DEV="$SELECTED_DEV"
    else
        PULSE_DEV="$SELECTED_DEV"
    fi
else
    # Auto-detect USB turntable / soundcard if none explicitly selected
    ALSA_CARD=$(arecord -l 2>/dev/null | grep -i -E "cx231xx|usb|codec|audio|turntable" | head -n1 | sed -n 's/card \([0-9]\+\):.*/\1/p')
    if [ -n "$ALSA_CARD" ]; then
        ALSA_DEV="plughw:$ALSA_CARD,0"
    fi
    # Also auto-detect USB turntable / soundcard in PulseAudio / PipeWire
    if command -v pactl >/dev/null 2>&1; then
        DETECTED_PULSE=$(pactl list sources short 2>/dev/null | grep -i -E "usb|codec|audio|turntable|cx231xx" | grep -v "\.monitor" | head -n1 | awk '{print $2}')
        if [ -n "$DETECTED_PULSE" ]; then
            PULSE_DEV="$DETECTED_PULSE"
        fi
    fi
fi

# Filter arguments: bypass -af if all EQ bands are 0 dB (pure bit-perfect pass-through)
AF_ARGS=()
if [ "$BASS" != "0" ] && [ "$BASS" != "0.0" ] || [ "$MID" != "0" ] && [ "$MID" != "0.0" ] || [ "$TREBLE" != "0" ] && [ "$TREBLE" != "0.0" ]; then
    AF_ARGS=(-af "$EQ_FILTER")
fi

# 1. Primary: FFmpeg with real-time 3-band EQ filter graph
if command -v ffmpeg >/dev/null 2>&1; then
    # If PulseAudio / PipeWire is running, capture via pulse
    if pactl info >/dev/null 2>&1; then
        ffmpeg -loglevel error -flush_packets 1 -f pulse -i "$PULSE_DEV" "${AF_ARGS[@]}" -f s16le -ar 44100 -ac 2 - > "$PIPE"
    else
        ffmpeg -loglevel error -flush_packets 1 -f alsa -i "$ALSA_DEV" "${AF_ARGS[@]}" -f s16le -ar 44100 -ac 2 - > "$PIPE"
    fi
fi

# 2. PipeWire pw-cat fallback
if command -v pw-cat >/dev/null 2>&1; then
    TARGET=""
    DEV=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='audio_device';" 2>/dev/null || echo "")
    if [ -n "$DEV" ] && [ "$DEV" != "@DEFAULT_SOURCE@" ] && [ "$DEV" != "default" ]; then
        TARGET="--target=$DEV"
    fi
    exec pw-cat --record $TARGET --format=s16 --rate=44100 --channels=2 --raw - > "$PIPE"
fi

# 3. ALSA arecord fallback
if command -v arecord >/dev/null 2>&1; then
    exec arecord -q -D "$ALSA_DEV" -f S16_LE -r 44100 -c 2 > "$PIPE"
fi

echo "[AnalogAir Capture] Error: No audio capture utility found (pw-cat, arecord, ffmpeg)."
exit 1
