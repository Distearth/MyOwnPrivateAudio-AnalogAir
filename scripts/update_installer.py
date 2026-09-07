#!/usr/bin/env python3
"""
Helper script to sync the latest scripts/analogair_daemon.py, scripts/analogair_web.py,
and dist/ web UI bundle into install.sh.
"""
import base64
import gzip
import io
import os
import tarfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    daemon_path = os.path.join(ROOT_DIR, "scripts", "analogair_daemon.py")
    web_path = os.path.join(ROOT_DIR, "scripts", "analogair_web.py")
    dist_dir = os.path.join(ROOT_DIR, "dist")

    with open(daemon_path, "r", encoding="utf-8") as f:
        daemon_code = f.read()

    with open(web_path, "r", encoding="utf-8") as f:
        web_code = f.read()

    # Locate dist assets (HTML, CSS, JS)
    js_files = [f for f in os.listdir(os.path.join(dist_dir, "assets")) if f.endswith(".js")]
    css_files = [f for f in os.listdir(os.path.join(dist_dir, "assets")) if f.endswith(".css")]
    
    js_filename = js_files[0]
    css_filename = css_files[0]

    with open(os.path.join(dist_dir, "index.html"), "rb") as f:
        b64_html = base64.b64encode(gzip.compress(f.read(), 9)).decode("ascii")

    with open(os.path.join(dist_dir, "assets", js_filename), "rb") as f:
        b64_js = base64.b64encode(gzip.compress(f.read(), 9)).decode("ascii")

    with open(os.path.join(dist_dir, "assets", css_filename), "rb") as f:
        b64_css = base64.b64encode(gzip.compress(f.read(), 9)).decode("ascii")

    installer_content = f'''#!/bin/bash
# ==============================================================================
# AnalogAir - Smart Vinyl Audio Streamer & AirPlay Display
# Automated Setup & Dependency Installer for Raspberry Pi
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${{BASH_SOURCE[0]}}")" && pwd)"

# ANSI Color Codes
GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
CYAN='\\033[0;36m'
NC='\\033[0m'

clear
cat << "BANNER"
    _                  _                 _     _      
   / \\   _ __   __ _  | | ___   __ _    / \\   (_)_ __ 
  / _ \\ | \'_ \\ / _` | | |/ _ \\ / _` |  / _ \\  | | \'__|
 / ___ \\| | | | (_| | | | (_) | (_| | / ___ \\ | | |   
/_/   \\_\\_| |_|\\__,_| |_|\\___/ \\__, |/_/   \\_\\|_|_|   
                               |___/                  
BANNER

echo -e "${{GREEN}}AnalogAir Smart Vinyl Audio Streamer Setup Wizard${{NC}}"
echo "--------------------------------------------------------"

# 1. Root check
if [ "$EUID" -eq 0 ]; then
  echo -e "${{RED}}Please run this script as your regular user (e.g., analogair or pi), NOT as root or with sudo.${{NC}}"
  echo "The installer will prompt for sudo when required."
  exit 1
fi

CURRENT_USER="$(whoami)"
USER_HOME="$HOME"

# 2. Interactive Questions
echo ""
echo -e "${{YELLOW}}[1/7] Configuration Setup${{NC}}"
read -p "Install for user [$CURRENT_USER]: " CONF_USER
CONF_USER="${{CONF_USER:-$CURRENT_USER}}"

DEFAULT_MUSIC_DIR="/home/$CONF_USER/Music"
read -p "Path to OwnTone Music directory [$DEFAULT_MUSIC_DIR]: " CONF_MUSIC_DIR
CONF_MUSIC_DIR="${{CONF_MUSIC_DIR:-$DEFAULT_MUSIC_DIR}}"

read -p "Idle Artist Name displayed on AirPlay [Audio-Technica]: " CONF_IDLE_ARTIST
CONF_IDLE_ARTIST="${{CONF_IDLE_ARTIST:-Audio-Technica}}"

read -p "Idle Album Name displayed on AirPlay [AT-LP60X Turntable]: " CONF_IDLE_ALBUM
CONF_IDLE_ALBUM="${{CONF_IDLE_ALBUM:-AT-LP60X Turntable}}"

read -p "Idle Stream Title [AnalogAir Vinyl]: " CONF_IDLE_TITLE
CONF_IDLE_TITLE="${{CONF_IDLE_TITLE:-AnalogAir Vinyl}}"

# 3. Audio Device Detection
echo ""
echo -e "${{YELLOW}}[2/7] Detecting Audio Capture Hardware${{NC}}"
echo "Searching for connected USB audio input devices..."
arecord -l || true
echo ""
echo "Enter your USB capture card ALSA name or leave blank for default PipeWire source (@DEFAULT_SOURCE@):"
read -p "Capture device name or card ID [@DEFAULT_SOURCE@]: " CONF_AUDIO_DEV
CONF_AUDIO_DEV="${{CONF_AUDIO_DEV:-@DEFAULT_SOURCE@}}"

# 4. System Packages Installation
echo ""
echo -e "${{YELLOW}}[3/7] Setting up OwnTone Repository & Dependencies${{NC}}"

sudo apt-get update
sudo apt-get install -y curl wget gnupg lsb-release sqlite3

# Add official OwnTone APT repository and keyring (supports Debian Trixie, Bookworm & Bullseye)
echo "Adding official OwnTone repository & GPG keyring..."
sudo mkdir -p /usr/share/keyrings
wget -q -O - https://raw.githubusercontent.com/owntone/owntone-apt/refs/heads/master/repo/rpi/owntone.gpg | sudo gpg --dearmor --yes -o /usr/share/keyrings/owntone-archive-keyring.gpg

DIST=$(lsb_release -cs 2>/dev/null || echo "trixie")
if [ "$DIST" != "trixie" ] && [ "$DIST" != "bookworm" ] && [ "$DIST" != "bullseye" ]; then
  DIST="trixie"
fi
sudo wget -q -O /etc/apt/sources.list.d/owntone.list "https://raw.githubusercontent.com/owntone/owntone-apt/refs/heads/master/repo/rpi/owntone-${{DIST}}.list"

# Refresh repos and install packages
sudo apt-get update
sudo apt-get install -y \\
  owntone \\
  pipewire \\
  pipewire-audio-client-libraries \\
  pipewire-pulse \\
  wireplumber \\
  alsa-utils \\
  ffmpeg \\
  python3 \\
  python3-pip \\
  python3-venv \\
  python3-numpy \\
  python3-pil \\
  pulseaudio-utils \\
  libportaudio2 \\
  portaudio19-dev \\
  git \\
  curl \\
  avahi-daemon

# Ensure systemd journal directory exists and user has read access to journal logs
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal 2>/dev/null || true
sudo usermod -a -G systemd-journal,audio "$CONF_USER" 2>/dev/null || true

# 5. Configure OwnTone Server (/etc/owntone.conf)
echo ""
echo -e "${{YELLOW}}[4/7] Configuring OwnTone Server (/etc/owntone.conf)${{NC}}"

PIPE_DIR="$CONF_MUSIC_DIR/AnalogAir"
mkdir -p "$PIPE_DIR"
mkdir -p "$USER_HOME/.config/analogair"
mkdir -p "$USER_HOME/.config/pipewire/filter-chain.conf.d"

# Backup original config if present
if [ -f /etc/owntone.conf ] && [ ! -f /etc/owntone.conf.original ]; then
  sudo cp /etc/owntone.conf /etc/owntone.conf.original
fi

# Ensure user and music directories have appropriate traverse permissions for OwnTone
sudo chmod 755 "$USER_HOME"
sudo chmod 755 "$CONF_MUSIC_DIR"
sudo chmod -R 777 "$PIPE_DIR"

# Write OwnTone configuration matching working vinyl pipe setup
sudo tee /etc/owntone.conf > /dev/null << CONFEOF
# OwnTone configuration generated by AnalogAir Setup Wizard
general {{
	uid = "root"
	db_path = "/var/cache/owntone/songs3.db"
	logfile = "/var/log/owntone.log"
	loglevel = log
	admin_password = ""
	trusted_networks = {{ "localhost", "192.168", "86.0", "10.0", "fd", "lan" }}
	start_buffer_ms = 1000
}}

library {{
	name = "AnalogAir on %h"
	port = 3689
	directories = {{ "$CONF_MUSIC_DIR", "$PIPE_DIR" }}
	name_unknown_artist = "$CONF_IDLE_ARTIST"
	name_unknown_album = "$CONF_IDLE_ALBUM"
	artwork_basenames = {{ "artwork", "cover", "Folder", "AnalogAir", "AnalogAir_default" }}
	artwork_individual = true
	pipe_autostart = true
}}

audio {{
	nickname = "AnalogAir Streamer"
}}
CONFEOF

echo "Restarting OwnTone service with updated configuration..."
sudo systemctl restart owntone

# 6. Create Named Pipes & Virtual Audio Engine
echo ""
echo -e "${{YELLOW}}[5/7] Creating Named Pipes & Virtual Audio Engine${{NC}}"

mkfifo "$PIPE_DIR/AnalogAir" 2>/dev/null || true
mkfifo "$PIPE_DIR/AnalogAir.metadata" 2>/dev/null || true
chmod 666 "$PIPE_DIR/AnalogAir" "$PIPE_DIR/AnalogAir.metadata" 2>/dev/null || true

# Copy default standby artwork to AnalogAir_default.jpg and live AnalogAir.jpg
python3 -c "
from PIL import Image, ImageDraw
import os
path = '$PIPE_DIR/AnalogAir_default.jpg'
if not os.path.exists(path):
    img = Image.new('RGB', (1000, 1000), color='#121216')
    draw = ImageDraw.Draw(img)
    draw.ellipse([100, 100, 900, 900], outline='#2a2a32', width=8)
    draw.ellipse([250, 250, 750, 750], outline='#222228', width=6)
    draw.ellipse([400, 400, 600, 600], fill='#d97706')
    draw.ellipse([480, 480, 520, 520], fill='#121216')
    img.save(path, 'JPEG', quality=90)
" 2>/dev/null || true
cp -f "$PIPE_DIR/AnalogAir_default.jpg" "$PIPE_DIR/AnalogAir.jpg" 2>/dev/null || true

# Initialize AnalogAir SQLite settings
python3 -c "
import sqlite3
conn = sqlite3.connect('$USER_HOME/.config/analogair/settings.db')
c = conn.cursor()
c.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)')
c.execute('CREATE TABLE IF NOT EXISTS favorite_speakers (speaker_id TEXT PRIMARY KEY)')
c.execute('CREATE TABLE IF NOT EXISTS overrides (key TEXT PRIMARY KEY, artist TEXT, album TEXT, title TEXT, art_url TEXT)')
settings = {{
    'audio_device': '$CONF_AUDIO_DEV',
    'pipe_dir': '$PIPE_DIR',
    'music_dir': '$CONF_MUSIC_DIR',
    'idle_artist': '$CONF_IDLE_ARTIST',
    'idle_album': '$CONF_IDLE_ALBUM',
    'idle_title': '$CONF_IDLE_TITLE',
    'silence_gap': '15',
    'silence_threshold': '0.0035',
    'source_type': 'vinyl',
    'continuous_id': 'false'
}}
for k, v in settings.items():
    c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (k, v))
conn.commit()
conn.close()
"

# Configure PipeWire Filter-Chain (Tone Controls)
cat << 'PWEOF' > "$USER_HOME/.config/pipewire/filter-chain.conf.d/analogair-tone.conf"
# AnalogAir Zero-Latency Hardware Tone & Gain Filter Chain
filter.chain = [
    {{
        name = "analogair-tone-dsp"
        type = "builtin"
        label = "biquad"
        control = {{
            "Preamp Gain" = 0.0
            "Bass Gain" = 1.5
            "Mid Gain" = 0.0
            "Treble Gain" = 0.5
        }}
    }}
]
PWEOF

# 7. Install Python VirtualEnv, Scripts & Web UI
echo ""
echo -e "${{YELLOW}}[6/7] Setting up Metadata Daemon & Web UI${{NC}}"
VENV_PATH="$USER_HOME/.config/analogair/venv"
python3 -m venv "$VENV_PATH" --system-site-packages
"$VENV_PATH/bin/pip" install --upgrade pip
"$VENV_PATH/bin/pip" install pyaudioop shazamio sounddevice numpy requests pillow aiohttp

# Copy or write AnalogAir Daemon script
if [ -f "$SCRIPT_DIR/scripts/analogair_daemon.py" ]; then
    echo "Installing analogair_daemon.py from local repository..."
    cp -f "$SCRIPT_DIR/scripts/analogair_daemon.py" "$USER_HOME/.config/analogair/analogair_daemon.py"
else
    echo "Writing embedded analogair_daemon.py..."
    cat << 'PYEOF_DAEMON' > "$USER_HOME/.config/analogair/analogair_daemon.py"
{daemon_code}
PYEOF_DAEMON
fi
chmod +x "$USER_HOME/.config/analogair/analogair_daemon.py"

# Copy or write AnalogAir Web script
if [ -f "$SCRIPT_DIR/scripts/analogair_web.py" ]; then
    echo "Installing analogair_web.py from local repository..."
    cp -f "$SCRIPT_DIR/scripts/analogair_web.py" "$USER_HOME/.config/analogair/analogair_web.py"
else
    echo "Writing embedded analogair_web.py..."
    cat << 'PYEOF_WEB' > "$USER_HOME/.config/analogair/analogair_web.py"
{web_code}
PYEOF_WEB
fi
chmod +x "$USER_HOME/.config/analogair/analogair_web.py"

# Install Touchscreen Web UI
mkdir -p "$USER_HOME/.config/analogair/ui"
mkdir -p "$USER_HOME/.config/analogair/ui/assets"
if [ -d "$SCRIPT_DIR/dist" ] && [ -f "$SCRIPT_DIR/dist/index.html" ]; then
    echo "Installing Web UI from local dist folder..."
    cp -rf "$SCRIPT_DIR/dist/"* "$USER_HOME/.config/analogair/ui/"
else
    echo "Installing standalone AnalogAir Touchscreen Web UI..."
    echo "{b64_html}" | base64 -d | gzip -d > "$USER_HOME/.config/analogair/ui/index.html"
    echo "{b64_js}" | base64 -d | gzip -d > "$USER_HOME/.config/analogair/ui/assets/{js_filename}"
    echo "{b64_css}" | base64 -d | gzip -d > "$USER_HOME/.config/analogair/ui/assets/{css_filename}"
    cp -f "$PIPE_DIR/AnalogAir_default.jpg" "$USER_HOME/.config/analogair/ui/assets/default_vinyl.jpg" 2>/dev/null || true
    cp -f "$PIPE_DIR/AnalogAir_default.jpg" "$USER_HOME/.config/analogair/ui/assets/default_idle.jpg" 2>/dev/null || true
    cp -f "$PIPE_DIR/AnalogAir_default.jpg" "$USER_HOME/.config/analogair/ui/assets/default_tape.jpg" 2>/dev/null || true
    cp -f "$PIPE_DIR/AnalogAir_default.jpg" "$USER_HOME/.config/analogair/ui/assets/default_cd.jpg" 2>/dev/null || true
fi

# Copy or write Audio Capture Pipe Broker script (with real-time 3-band shelf EQ DSP)
cat << 'PIPEEOF' > "$USER_HOME/.config/analogair/capture_pipe.sh"
#!/bin/bash
MUSIC_DIR="${{1:-$HOME/Music/AnalogAir}}"
PIPE="$MUSIC_DIR/AnalogAir"
mkdir -p "$MUSIC_DIR"
[ -p "$PIPE" ] || mkfifo "$PIPE"

DB="$HOME/.config/analogair/settings.db"
BASS=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='bass_gain_db';" 2>/dev/null || echo "0")
MID=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='mid_gain_db';" 2>/dev/null || echo "0")
TREBLE=$(sqlite3 "$DB" "SELECT value FROM settings WHERE key='treble_gain_db';" 2>/dev/null || echo "0")

BASS="${{BASS:-0}}"
MID="${{MID:-0}}"
TREBLE="${{TREBLE:-0}}"

EQ_FILTER="bass=g=${{BASS}}:f=100,equalizer=f=1000:width_type=q:w=1:g=${{MID}},treble=g=${{TREBLE}}:f=8000"

ALSA_CARD=$(arecord -l 2>/dev/null | grep -i -E "cx231xx|usb|codec|audio|turntable" | head -n1 | sed -n 's/card \([0-9]\+\):.*/\1/p')
ALSA_DEV="default"
if [ -n "$ALSA_CARD" ]; then
    ALSA_DEV="plughw:$ALSA_CARD,0"
fi

# 1. Primary: FFmpeg with real-time 3-band EQ filter graph
if command -v ffmpeg >/dev/null 2>&1; then
    if pactl info >/dev/null 2>&1; then
        exec ffmpeg -loglevel error -f pulse -i default -af "$EQ_FILTER" -f s16le -ar 44100 -ac 2 - > "$PIPE"
    else
        exec ffmpeg -loglevel error -f alsa -i "$ALSA_DEV" -af "$EQ_FILTER" -f s16le -ar 44100 -ac 2 - > "$PIPE"
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
PIPEEOF
chmod +x "$USER_HOME/.config/analogair/capture_pipe.sh"

# 8. Create Systemd User Services
echo ""
echo -e "${{YELLOW}}[7/7] Configuring Systemd User Services${{NC}}"
mkdir -p "$USER_HOME/.config/systemd/user"

# Service 1: Audio Pipe Broker
cat << SVCEOF > "$USER_HOME/.config/systemd/user/analogair-capture.service"
[Unit]
Description=AnalogAir Vinyl Audio Pipe Broker (Glitch-Free Non-Blocking)
After=pipewire.service wireplumber.service sound.target
Wants=pipewire.service wireplumber.service

[Service]
Type=simple
ExecStartPre=/bin/sh -c 'mkdir -p $CONF_MUSIC_DIR/AnalogAir && [ -p $CONF_MUSIC_DIR/AnalogAir/AnalogAir ] || mkfifo $CONF_MUSIC_DIR/AnalogAir/AnalogAir'
ExecStart=$USER_HOME/.config/analogair/capture_pipe.sh
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
SVCEOF

# Service 2: Metadata Recognition Daemon
cat << SVCEOF > "$USER_HOME/.config/systemd/user/analogair-daemon.service"
[Unit]
Description=AnalogAir Side-Aware Metadata & Artwork Daemon
After=analogair-capture.service
Wants=analogair-capture.service

[Service]
Type=simple
ExecStart=$VENV_PATH/bin/python3 $USER_HOME/.config/analogair/analogair_daemon.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
SVCEOF

# Service 3: AnalogAir Web UI Server (Port 3000)
cat << SVCEOF > "$USER_HOME/.config/systemd/user/analogair-web.service"
[Unit]
Description=AnalogAir Touchscreen & Mobile Web UI Server (Port 3000)
After=network.target analogair-daemon.service
Wants=analogair-daemon.service

[Service]
Type=simple
ExecStart=$VENV_PATH/bin/python3 $USER_HOME/.config/analogair/analogair_web.py
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
SVCEOF

systemctl --user daemon-reload
systemctl --user enable --now analogair-capture.service
systemctl --user enable --now analogair-daemon.service
systemctl --user enable --now analogair-web.service

# Enable lingering so user services keep running on headless boot
sudo loginctl enable-linger "$CONF_USER"

# Trigger OwnTone library rescan to index the pipe
curl -s -X POST http://127.0.0.1:3689/api/library/rescan 2>/dev/null || true

PI_IP=$(hostname -I 2>/dev/null | awk '{{print $1}}')
PI_IP="${{PI_IP:-localhost}}"

echo ""
echo -e "${{GREEN}}========================================================${{NC}}"
echo -e "${{GREEN}} AnalogAir Installation Complete!${{NC}}"
echo -e "${{GREEN}}========================================================${{NC}}"
echo ""
echo "Your Raspberry Pi is now streaming vinyl audio to OwnTone."
echo ""
echo -e " 1. OwnTone AirPlay Admin:        ${{BLUE}}http://${{PI_IP}}:3689${{NC}}"
echo -e " 2. AnalogAir Web / Touchscreen:  ${{BLUE}}http://${{PI_IP}}:3000${{NC}}"
echo " 3. Audio Pipe Location:          $CONF_MUSIC_DIR/AnalogAir/AnalogAir"
echo " 4. Live Artwork:                 $CONF_MUSIC_DIR/AnalogAir/AnalogAir.jpg"
echo " 5. Standby Artwork:              $CONF_MUSIC_DIR/AnalogAir/AnalogAir_default.jpg"
echo ""
echo "Next Steps:"
echo " - Connect your turntable / USB capture card to any USB port on your Pi."
echo " - Open OwnTone (http://${{PI_IP}}:3689) and select your AirPlay speakers."
echo " - Open the AnalogAir Web UI (http://${{PI_IP}}:3000) on your phone, tablet, or touchscreen for album art and tone controls!"
echo ""
'''

    with open(os.path.join(ROOT_DIR, "install.sh"), "w", encoding="utf-8") as f:
        f.write(installer_content)

    print("install.sh successfully updated!")

if __name__ == "__main__":
    main()
