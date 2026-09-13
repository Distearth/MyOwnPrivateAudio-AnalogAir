#!/usr/bin/env python3
"""
AnalogAir Local Web UI & API Server
Serves the AnalogAir Touchscreen / Mobile interface on port 3000
Proxies OwnTone outputs (AirPlay speakers), tone DSP controls, SQLite settings,
MusicBrainz/iTunes metadata lookups, and installer downloads.
"""
import os
import json
import sqlite3
import subprocess
import shutil
import re
import time
import math
import struct
import base64
import urllib.parse
import threading
from datetime import datetime
from pathlib import Path
import asyncio
from aiohttp import web
import aiohttp

HOME = Path.home()
CONFIG_DIR = HOME / ".config" / "analogair"
UI_DIR = CONFIG_DIR / "ui"
REPO_DIST = Path(__file__).resolve().parent.parent / "dist"
if not (UI_DIR / "index.html").exists() and (REPO_DIST / "index.html").exists():
    UI_DIR = REPO_DIST

DB_PATH = CONFIG_DIR / "settings.db"
STATE_FILE = Path("/tmp/analogair_state.json")
PIPE_DIR = HOME / "Music" / "AnalogAir"
PIPE_PATH = PIPE_DIR / "AnalogAir.metadata"
DEFAULT_ART_PATH = PIPE_DIR / "AnalogAir_default.jpg"
LIVE_ART_PATH = PIPE_DIR / "AnalogAir.jpg"

FALLBACK_ART_PATH = Path(__file__).resolve().parent.parent / "dist" / "assets" / "default_idle.jpg"
FALLBACK_SRC_ART = Path(__file__).resolve().parent.parent / "src" / "assets" / "images" / "analogair_idle_art_1788723997443.jpg"

INSTALL_SH_PATH = Path(__file__).resolve().parent.parent / "install.sh"
UPDATE_SH_PATH = Path(__file__).resolve().parent.parent / "update.sh"
DAEMON_SCRIPT_PATH = Path(__file__).resolve().parent / "analogair_daemon.py"
WEB_SCRIPT_PATH = Path(__file__).resolve()

OWNTONE_BASE = "http://127.0.0.1:3689"

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def sanitize_album_title(title: str) -> str:
    if not title:
        return ""
    cleaned = title
    patterns = [
        # Parenthetical or bracketed notes containing remaster, edition, mix, anniversary, or mastering credits
        r"\s*[\(\[][^()\[\]]*(?:re-?master|remix|edition|version|soundtrack|anniversary|deluxe|expanded|legacy|bonus\s+track|mastered\s+by|master\s+by|half-speed)[^()\[\]]*(?:[\)\]]|$)",
        # Hyphenated suffixes
        r"\s*-\s*.*?(?:re-?master|mastered\s+by|deluxe|anniversary).*$",
        r"\s*-\s*(?:single|ep)\s*$",
        r"\s*[\(\[]\s*(?:single|ep)\s*[\)\]]$",
    ]
    for pat in patterns:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" -–—()[]").strip()
    return cleaned if cleaned else title

def sanitize_track_title(title: str) -> str:
    if not title:
        return ""
    cleaned = title
    patterns = [
        r"\s*[\(\[][^()\[\]]*(?:re-?master|remix|edition|version|soundtrack|anniversary|deluxe|expanded|legacy|bonus\s+track|mastered\s+by|master\s+by|half-speed)[^()\[\]]*(?:[\)\]]|$)",
        r"\s*-\s*.*?(?:re-?master|mastered\s+by|deluxe|anniversary).*$",
    ]
    for pat in patterns:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.strip(" -–—()[]").strip()
    return cleaned if cleaned else title

def init_db():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
        c.execute("""
            CREATE TABLE IF NOT EXISTS release_overrides (
                track_key TEXT PRIMARY KEY,
                custom_artist TEXT,
                custom_album TEXT NOT NULL,
                custom_art_url TEXT,
                release_mbid TEXT,
                format TEXT,
                year TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        try:
            c.execute("ALTER TABLE release_overrides ADD COLUMN format TEXT")
        except Exception:
            pass
        try:
            c.execute("ALTER TABLE release_overrides ADD COLUMN year TEXT")
        except Exception:
            pass
        c.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                artist TEXT,
                album TEXT,
                first_track TEXT,
                art_url TEXT,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                play_count INTEGER DEFAULT 1,
                mbid TEXT,
                has_override INTEGER DEFAULT 0
            )
        """)
        c.execute("CREATE TABLE IF NOT EXISTS favorite_speakers (speaker_id TEXT PRIMARY KEY)")
        
        # Seed default settings if empty
        defaults = {
            "source_type": "vinyl",
            "enable_recognition": "false",
            "idle_artist": "Audio-Technica",
            "idle_album": "AT-LP60X Turntable",
            "idle_title": "AnalogAir Vinyl",
            "silence_gap": "15",
            "continuous_id": "false",
            "dim_minutes": "25",
            "idle_fade_seconds": "10",
            "owntone_host": "localhost",
            "owntone_port": "3689",
            "enable_tone_dsp": "true",
            "input_gain_db": "0.0",
            "bass_gain_db": "1.5",
            "mid_gain_db": "0.0",
            "treble_gain_db": "0.5"
        }
        for k, v in defaults.items():
            c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        conn.commit()

# --- Pipe Metadata Helpers ---
def encode_b64(text):
    return base64.b64encode(str(text).encode("utf-8")).decode("utf-8")

def make_xml(title, artist, album):
    return f"""<item><type>61727473</type><code>6173746e</code><data encoding="base64">{encode_b64(title)}</data></item>
<item><type>61727473</type><code>61736172</code><data encoding="base64">{encode_b64(artist)}</data></item>
<item><type>61727473</type><code>6173616c</code><data encoding="base64">{encode_b64(album)}</data></item>
"""

def write_to_metadata_pipe(title, artist, album):
    if PIPE_PATH.exists():
        try:
            xml_data = make_xml(title, artist, album)
            fd = os.open(str(PIPE_PATH), os.O_WRONLY | os.O_NONBLOCK)
            os.write(fd, xml_data.encode("utf-8"))
            os.close(fd)
        except Exception:
            pass

# --- 1. Now Playing State & Mode ---
async def get_state(request):
    state = {}
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r") as f:
                state = json.load(f)
        except Exception:
            pass

    settings = {}
    with get_db() as conn:
        for row in conn.execute("SELECT key, value FROM settings"):
            settings[row["key"]] = row["value"]

    idle_artist = settings.get("idle_artist", "Audio-Technica")
    idle_album = settings.get("idle_album", "AT-LP60X Turntable")
    idle_title = settings.get("idle_title", "AnalogAir Vinyl")

    has_daemon_state = bool(state)
    status = state.get("status", "idle")
    artist = state.get("artist", idle_artist)
    album = sanitize_album_title(state.get("album", idle_album))
    title = sanitize_track_title(state.get("title", idle_title))
    rms = state.get("rms", 0.0)
    matched_via = state.get("matched_via", "idle_default" if status == "idle" else "shazam")
    mbid = state.get("mbid")

    if not has_daemon_state:
        status = "idle"

    if status == "idle":
        custom_art = settings.get("default_art_url") or settings.get("defaultArtUrl") or ""
        if custom_art and "custom-standby" in custom_art:
            art_url = custom_art
        else:
            art_url = "/api/artwork/custom-standby.jpg"
    else:
        raw_art = state.get("art_url") or state.get("artUrl") or ""
        if raw_art.startswith("http"):
            art_url = raw_art
        else:
            v_tag = int(LIVE_ART_PATH.stat().st_mtime) if LIVE_ART_PATH.exists() else int(time.time())
            art_url = f"/api/artwork/current.jpg?v={v_tag}"

    return web.json_response({
        "status": status,
        "artist": artist,
        "album": album,
        "title": title,
        "artUrl": art_url,
        "mbid": mbid,
        "rmsLevel": rms,
        "sampleRate": 44100,
        "bitDepth": 16,
        "sourceType": settings.get("source_type", "vinyl"),
        "isContinuous": settings.get("continuous_id", "false").lower() == "true",
        "sideLocked": True,
        "inputDeviceName": "AnalogAir Vinyl (PipeWire Capture)",
        "matchedVia": matched_via,
        "startedAt": state.get("startedAt", ""),
        "tone": {
            "inputGainDb": float(settings.get("input_gain_db", 0)),
            "bassGainDb": float(settings.get("bass_gain_db", 1.5)),
            "midGainDb": float(settings.get("mid_gain_db", 0)),
            "trebleGainDb": float(settings.get("treble_gain_db", 0.5)),
            "selectedDeviceId": settings.get("audio_device", "@DEFAULT_SOURCE@")
        },
        "settings": {
            "sourceType": settings.get("source_type", "vinyl"),
            "customStreamLabel": "AnalogAir Vinyl",
            "defaultArtUrl": "/api/artwork/custom-standby.jpg",
            "idleArtist": idle_artist,
            "idleAlbum": idle_album,
            "idleTitle": idle_title,
            "enableRecognition": settings.get("enable_recognition", "false").lower() == "true",
            "continuousId": settings.get("continuous_id", "false").lower() == "true",
            "silenceGapSeconds": int(settings.get("silence_gap", 15)),
            "sampleDuration": int(settings.get("sample_duration", 10)),
            "dimMinutes": int(settings.get("dim_minutes", 25)),
            "idleFadeSeconds": int(settings.get("idle_fade_seconds", 10)),
            "owntoneHost": settings.get("owntone_host", "localhost"),
            "owntonePort": int(settings.get("owntone_port", 3689)),
            "enableToneDsp": settings.get("enable_tone_dsp", "true").lower() == "true"
        }
    })

async def toggle_mode(request):
    data = await request.json()
    continuous = bool(data.get("continuous", False))
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('continuous_id', ?)", (str(continuous).lower(),))
        conn.commit()

    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r") as f:
                st = json.load(f)
            st["is_continuous"] = continuous
            with open(STATE_FILE, "w") as f:
                json.dump(st, f)
        except Exception:
            pass

    return web.json_response({"success": True, "continuousId": continuous})

# --- 2. Tone Controls & Hardware Routing ---
async def get_tone(request):
    settings = {}
    with get_db() as conn:
        for row in conn.execute("SELECT key, value FROM settings"):
            settings[row["key"]] = row["value"]

    devices = [{
        "id": "@DEFAULT_SOURCE@",
        "name": "PipeWire Auto-Select / Default Source",
        "cardIndex": 0,
        "supportedRates": [44100, 48000],
        "isDefault": True,
        "channels": 2
    }]

    # 1. PipeWire / PulseAudio sources via pactl
    try:
        res = subprocess.run(["pactl", "list", "sources"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        current_name = None
        current_desc = None
        for line in res.stdout.splitlines():
            line_str = line.strip()
            if line_str.startswith("Name:"):
                current_name = line_str.split(":", 1)[1].strip()
            elif line_str.startswith("Description:"):
                current_desc = line_str.split(":", 1)[1].strip()
                if current_name and not current_name.endswith(".monitor"):
                    if not any(d["id"] == current_name for d in devices):
                        devices.append({
                            "id": current_name,
                            "name": current_desc or current_name,
                            "cardIndex": len(devices),
                            "supportedRates": [44100, 48000],
                            "isDefault": False,
                            "channels": 2
                        })
                current_name = None
                current_desc = None
    except Exception:
        pass

    # 2. ALSA hardware cards via arecord -l
    try:
        res = subprocess.run(["arecord", "-l"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for line in res.stdout.splitlines():
            if line.startswith("card "):
                m = re.match(r"card\s+(\d+):\s+([^,]+),\s+device\s+(\d+):\s+(.*)", line)
                if m:
                    card_num, card_name, dev_num, dev_desc = m.groups()
                    hw_id = f"hw:{card_num},{dev_num}"
                    if not any(d["id"] == hw_id for d in devices):
                        devices.append({
                            "id": hw_id,
                            "name": f"ALSA Direct: {card_name.strip()} ({dev_desc.strip()})",
                            "cardIndex": int(card_num),
                            "supportedRates": [44100, 48000],
                            "isDefault": False,
                            "channels": 2
                        })
    except Exception:
        pass

    saved_dev = settings.get("audio_device", "@DEFAULT_SOURCE@")

    return web.json_response({
        "inputGainDb": float(settings.get("input_gain_db", 0)),
        "bassGainDb": float(settings.get("bass_gain_db", 1.5)),
        "midGainDb": float(settings.get("mid_gain_db", 0)),
        "trebleGainDb": float(settings.get("treble_gain_db", 0.5)),
        "selectedDeviceId": saved_dev,
        "deviceList": devices
    })

async def save_tone(request):
    data = await request.json()
    with get_db() as conn:
        for k in ["inputGainDb", "bassGainDb", "midGainDb", "trebleGainDb"]:
            if k in data:
                db_key = {
                    "inputGainDb": "input_gain_db",
                    "bassGainDb": "bass_gain_db",
                    "midGainDb": "mid_gain_db",
                    "trebleGainDb": "treble_gain_db"
                }[k]
                conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (db_key, str(data[k])))
        if "selectedDeviceId" in data:
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('audio_device', ?)", (str(data["selectedDeviceId"]),))
        conn.commit()

    selected_dev = data.get("selectedDeviceId")
    if not selected_dev:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='audio_device'").fetchone()
            if row:
                selected_dev = row["value"]

    if "inputGainDb" in data:
        try:
            gain_db = float(data["inputGainDb"])
            vol_pct = max(0, min(400, int(round(100.0 * (10.0 ** (gain_db / 20.0))))))
            
            subprocess.run(["pactl", "set-source-volume", "@DEFAULT_SOURCE@", f"{vol_pct}%"], 
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            if selected_dev and selected_dev not in ["@DEFAULT_SOURCE@", "default"]:
                subprocess.run(["pactl", "set-source-volume", selected_dev, f"{vol_pct}%"], 
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            if selected_dev and selected_dev.startswith("hw:"):
                try:
                    card_idx = selected_dev.split(":")[1].split(",")[0]
                    for ctrl in ["Capture", "Line", "Mic"]:
                        subprocess.run(["amixer", "-c", card_idx, "sset", ctrl, f"{vol_pct}%"], 
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:
                    pass
            else:
                for card in ["0", "1", "2", "3"]:
                    for ctrl in ["Capture", "Line", "Mic"]:
                        subprocess.run(["amixer", "-c", card, "sset", ctrl, f"{vol_pct}%"], 
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    if any(k in data for k in ["bassGainDb", "midGainDb", "trebleGainDb", "selectedDeviceId"]):
        try:
            # Reset any failed state so systemd never locks out the capture service
            subprocess.run(["systemctl", "--user", "reset-failed", "analogair-capture.service"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["systemctl", "--user", "restart", "analogair-capture.service"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if "selectedDeviceId" in data:
                subprocess.run(["systemctl", "--user", "restart", "analogair-daemon.service"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        # Trigger OwnTone to resume playing the stream if pipe was temporarily cycled
        def resume_owntone():
            time.sleep(0.4)
            try:
                subprocess.run(["curl", "-s", "-X", "POST", "http://127.0.0.1:3689/api/player/play"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1.0)
            except Exception:
                pass
        threading.Thread(target=resume_owntone, daemon=True).start()

    # Clean up any obsolete/invalid PipeWire filter-chain configuration to prevent PipeWire service failures
    pw_conf = HOME / ".config" / "pipewire" / "filter-chain.conf.d" / "analogair-tone.conf"
    if pw_conf.exists():
        try:
            pw_conf.unlink()
        except Exception:
            pass

    return web.json_response({"success": True, "tone": data})

def sample_audio_levels():
    """
    Directly measures active line-level audio signal (RMS and Peak dBFS) 
    from PulseAudio/PipeWire or ALSA in real-time (~100ms sample).
    Returns dict with dbfs, peakDbfs, leftPeakDbfs, rightPeakDbfs, etc.
    """
    settings = get_settings_dict()
    gain_db = float(settings.get("input_gain_db", 0.0))
    selected_dev = settings.get("audio_device", "").strip()

    # Determine PulseAudio / PipeWire source
    pulse_source = "default"
    if selected_dev and selected_dev not in ["default", "@DEFAULT_SOURCE@"] and not selected_dev.startswith("hw:"):
        pulse_source = selected_dev
    elif shutil.which("pactl"):
        try:
            res = subprocess.run(["pactl", "list", "sources", "short"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=0.6)
            for line in res.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    s_name = parts[1]
                    lower = s_name.lower()
                    if not s_name.endswith(".monitor") and any(k in lower for k in ["usb", "codec", "audio", "turntable", "cx231xx"]):
                        pulse_source = s_name
                        break
            if pulse_source == "default":
                for line in res.stdout.splitlines():
                    parts = line.split()
                    if len(parts) >= 2 and not parts[1].endswith(".monitor"):
                        pulse_source = parts[1]
                        break
        except Exception:
            pass

    raw_bytes = None

    # 1. Primary: FFmpeg non-blocking pulse tap (captures exact 100ms chunk without blocking)
    if shutil.which("ffmpeg"):
        try:
            target = pulse_source if pulse_source else "default"
            cmd = [
                "ffmpeg", "-y", "-loglevel", "quiet",
                "-f", "pulse", "-i", target,
                "-t", "0.1",
                "-f", "s16le", "-ar", "44100", "-ac", "2",
                "-"
            ]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=0.35)
            if res.stdout and len(res.stdout) >= 512:
                raw_bytes = res.stdout
        except Exception:
            pass

    # 2. Native PulseAudio client: parec with communicate(timeout=0.2)
    if (not raw_bytes or len(raw_bytes) < 512) and shutil.which("parec"):
        try:
            cmd = ["parec", "--raw", "--format=s16le", "--rate=44100", "--channels=2", "--latency-msec=30"]
            if pulse_source and pulse_source != "default":
                cmd.extend(["-d", pulse_source])
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                raw_bytes, _ = proc.communicate(timeout=0.2)
            except subprocess.TimeoutExpired:
                proc.kill()
                raw_bytes, _ = proc.communicate()
        except Exception:
            pass

    # 3. PipeWire pw-cat fallback with communicate(timeout=0.2)
    if (not raw_bytes or len(raw_bytes) < 512):
        for tool in ["pw-record", "pw-cat"]:
            if shutil.which(tool):
                try:
                    cmd = [tool]
                    if tool == "pw-cat":
                        cmd.append("--record")
                    if pulse_source and pulse_source != "default":
                        cmd.extend(["--target", pulse_source])
                    cmd.extend(["--rate=44100", "--channels=2", "--format=s16", "--raw", "-"])
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                    try:
                        raw_bytes, _ = proc.communicate(timeout=0.2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        raw_bytes, _ = proc.communicate()
                    if raw_bytes and len(raw_bytes) >= 512:
                        break
                except Exception:
                    pass

    # 4. ALSA arecord direct fallback
    if (not raw_bytes or len(raw_bytes) < 512) and shutil.which("arecord") and selected_dev.startswith("hw:"):
        try:
            cmd = ["arecord", "-q", "-D", selected_dev, "-d", "1", "-f", "S16_LE", "-r", "44100", "-c", "2"]
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            try:
                raw_bytes, _ = proc.communicate(timeout=0.2)
            except subprocess.TimeoutExpired:
                proc.kill()
                raw_bytes, _ = proc.communicate()
        except Exception:
            pass

    # Process real audio samples if captured
    if raw_bytes and len(raw_bytes) >= 512:
        count = len(raw_bytes) // 2
        samples = struct.unpack(f"<{count}h", raw_bytes[:count * 2])
        left_samples = samples[0::2]
        right_samples = samples[1::2] if len(samples) > 1 else left_samples

        l_max = max(abs(s) for s in left_samples) if left_samples else 0
        r_max = max(abs(s) for s in right_samples) if right_samples else 0
        overall_max = max(l_max, r_max)

        l_sq = sum(s * s for s in left_samples) / len(left_samples) if left_samples else 0
        r_sq = sum(s * s for s in right_samples) / len(right_samples) if right_samples else 0
        overall_sq = (l_sq + r_sq) / 2.0

        raw_peak = overall_max / 32768.0
        raw_rms = math.sqrt(overall_sq) / 32768.0

        gain_factor = 10.0 ** (gain_db / 20.0)
        adjusted_peak = min(1.0, raw_peak * gain_factor)
        adjusted_rms = min(1.0, raw_rms * gain_factor)

        l_peak = min(1.0, (l_max / 32768.0) * gain_factor)
        r_peak = min(1.0, (r_max / 32768.0) * gain_factor)

        def to_db(v):
            return round(20.0 * math.log10(max(0.00001, v)), 1) if v > 0.00001 else -96.0

        dbfs = to_db(adjusted_rms)
        peak_dbfs = to_db(adjusted_peak)
        l_dbfs = to_db(l_peak)
        r_dbfs = to_db(r_peak)

        is_clipping = peak_dbfs >= -0.5
        is_hot = peak_dbfs >= -3.0
        is_optimal = peak_dbfs >= -14.0 and not is_hot

        return {
            "rms": round(adjusted_rms, 5),
            "rawRms": round(raw_rms, 5),
            "dbfs": dbfs,
            "peakDbfs": peak_dbfs,
            "leftPeakDbfs": l_dbfs,
            "rightPeakDbfs": r_dbfs,
            "gainDb": gain_db,
            "isClipping": is_clipping,
            "isHot": is_hot,
            "isOptimal": is_optimal,
            "status": "playing" if peak_dbfs > -45.0 else "idle",
            "source": pulse_source,
            "timestamp": time.time()
        }

    # Fallback to daemon state file if direct capture was not possible
    status = "idle"
    cached_rms = 0.0
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r") as f:
                d = json.load(f)
                cached_rms = float(d.get("rms", 0.0))
                status = d.get("status", "idle")
        except Exception:
            pass

    if cached_rms > 0.0001:
        gain_factor = 10.0 ** (gain_db / 20.0)
        adj_rms = min(1.0, cached_rms * gain_factor)
        dbfs = round(20.0 * math.log10(adj_rms), 1)
        peak_rms = min(1.0, adj_rms * 1.48)
        peak_dbfs = round(20.0 * math.log10(peak_rms), 1)
        is_clipping = peak_dbfs >= -0.5
        is_hot = peak_dbfs >= -3.0
        is_optimal = peak_dbfs >= -14.0 and not is_hot
        return {
            "rms": round(adj_rms, 5),
            "rawRms": round(cached_rms, 5),
            "dbfs": dbfs,
            "peakDbfs": peak_dbfs,
            "leftPeakDbfs": peak_dbfs,
            "rightPeakDbfs": peak_dbfs,
            "gainDb": gain_db,
            "isClipping": is_clipping,
            "isHot": is_hot,
            "isOptimal": is_optimal,
            "status": status,
            "source": "daemon_state",
            "timestamp": time.time()
        }

    # Simulated vinyl playback fallback if playing (e.g. cloud preview container)
    if status == "playing":
        t = time.time()
        osc = math.sin(t * 2.5) * 0.03 + math.cos(t * 1.1) * 0.02
        sim_rms = max(0.04, min(1.0, (0.16 + osc) * (10.0 ** (gain_db / 20.0))))
        dbfs = round(20.0 * math.log10(sim_rms), 1)
        sim_peak = min(1.0, sim_rms * 1.45)
        peak_dbfs = round(20.0 * math.log10(sim_peak), 1)
        is_clipping = peak_dbfs >= -0.5
        is_hot = peak_dbfs >= -3.0
        is_optimal = peak_dbfs >= -14.0 and not is_hot
        return {
            "rms": round(sim_rms, 5),
            "rawRms": 0.16,
            "dbfs": dbfs,
            "peakDbfs": peak_dbfs,
            "leftPeakDbfs": round(peak_dbfs - 0.4, 1),
            "rightPeakDbfs": round(peak_dbfs + 0.2, 1),
            "gainDb": gain_db,
            "isClipping": is_clipping,
            "isHot": is_hot,
            "isOptimal": is_optimal,
            "status": "playing",
            "source": "simulated",
            "timestamp": time.time()
        }

    return {
        "rms": 0.0,
        "rawRms": 0.0,
        "dbfs": -96.0,
        "peakDbfs": -96.0,
        "leftPeakDbfs": -96.0,
        "rightPeakDbfs": -96.0,
        "gainDb": gain_db,
        "isClipping": False,
        "isHot": False,
        "isOptimal": False,
        "status": status,
        "source": "none",
        "timestamp": time.time()
    }

async def get_audio_level(request):
    """Returns live line-level RMS and peak dBFS from active PulseAudio/PipeWire stream."""
    loop = asyncio.get_event_loop()
    data = await loop.run_in_executor(None, sample_audio_levels)
    return web.json_response(data)

# --- 3. OwnTone Multi-Room Speaker Outputs ---
async def get_owntone_outputs(request):
    fav_ids = set()
    with get_db() as conn:
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS favorite_speakers (speaker_id TEXT PRIMARY KEY)")
            for row in conn.execute("SELECT speaker_id FROM favorite_speakers"):
                fav_ids.add(str(row["speaker_id"]))
        except Exception:
            pass

    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(f"{OWNTONE_BASE}/api/outputs", timeout=2) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    outputs = data.get("outputs", [])
                    for o in outputs:
                        o["id"] = str(o.get("id"))
                        o["isFavorite"] = str(o.get("id")) in fav_ids
                    return web.json_response({"outputs": outputs, "favoriteSpeakers": list(fav_ids)})
        except Exception:
            pass
    return web.json_response({"outputs": [], "favoriteSpeakers": list(fav_ids)})

async def toggle_favorite_output(request):
    output_id = str(request.match_info["id"])
    is_fav = False
    with get_db() as conn:
        c = conn.cursor()
        c.execute("CREATE TABLE IF NOT EXISTS favorite_speakers (speaker_id TEXT PRIMARY KEY)")
        c.execute("SELECT speaker_id FROM favorite_speakers WHERE speaker_id=?", (output_id,))
        row = c.fetchone()
        if row:
            c.execute("DELETE FROM favorite_speakers WHERE speaker_id=?", (output_id,))
            is_fav = False
        else:
            c.execute("INSERT OR REPLACE INTO favorite_speakers (speaker_id) VALUES (?)", (output_id,))
            is_fav = True
        conn.commit()

        fav_rows = conn.execute("SELECT speaker_id FROM favorite_speakers").fetchall()
        all_favs = [str(r["speaker_id"]) for r in fav_rows]

    return web.json_response({"success": True, "isFavorite": is_fav, "favoriteSpeakers": all_favs})

async def ensure_owntone_playing():
    """
    Ensures OwnTone is actively playing the stream from the pipe.
    If the player is paused or stopped (e.g. after destinations went offline),
    resumes or starts playback immediately.
    """
    async with aiohttp.ClientSession() as session:
        try:
            # 1. Query current player state
            player_state = None
            async with session.get(f"{OWNTONE_BASE}/api/player", timeout=2) as r:
                if r.status == 200:
                    data = await r.json()
                    player_state = data.get("state")

            if player_state == "play":
                return True

            # 2. If paused, try resume/play via PUT /api/player/play or toggle
            if player_state == "pause":
                for path in ("/api/player/play", "/api/player/toggle"):
                    try:
                        async with session.put(f"{OWNTONE_BASE}{path}", timeout=2) as r_pause:
                            if r_pause.status in (200, 204):
                                return True
                    except Exception:
                        pass

            # 3. Try starting playback via PUT /api/player/play and POST /api/player/play
            for method in (session.put, session.post):
                try:
                    async with method(f"{OWNTONE_BASE}/api/player/play", timeout=2) as r_play:
                        if r_play.status in (200, 204):
                            break
                except Exception:
                    pass

            await asyncio.sleep(0.2)
            async with session.get(f"{OWNTONE_BASE}/api/player", timeout=2) as r2:
                if r2.status == 200:
                    if (await r2.json()).get("state") == "play":
                        return True

            # 4. If still not playing, try adding the AnalogAir pipe track to the queue and starting playback
            for expr in (
                'path contains "AnalogAir"',
                'title contains "AnalogAir"',
                'media_kind is pipe'
            ):
                try:
                    async with session.post(
                        f"{OWNTONE_BASE}/api/queue/items/add",
                        params={"expression": expr, "clear": "true", "playback": "start"},
                        timeout=2
                    ) as rq:
                        if rq.status in (200, 204):
                            break
                except Exception:
                    pass

            # Final verify/resume
            try:
                async with session.put(f"{OWNTONE_BASE}/api/player/play", timeout=2) as r_final:
                    pass
            except Exception:
                pass

            return True
        except Exception as e:
            print(f"[AnalogAir Web] ensure_owntone_playing: {e}", flush=True)
            return False

async def purge_owntone_buffer(request):
    """
    Clears the accumulated 30s FIFO pipe and receiver delay by restarting the
    audio capture service and OwnTone service via passwordless sudo.
    Restores active output playback instantly with real-time needle audio.
    """
    print("[AnalogAir Web] Purge buffer requested. Restarting audio pipeline...", flush=True)
    loop = asyncio.get_event_loop()
    
    def _restart_pipeline():
        try:
            # 1. Restart user audio capture (kills stale ffmpeg/parec process)
            subprocess.run(["systemctl", "--user", "restart", "analogair-capture.service"], timeout=5)
        except Exception as e:
            print(f"[AnalogAir Web] Error restarting capture: {e}", flush=True)
        try:
            # 2. Restart OwnTone system service to dump stale HTTP/mDNS buffer queues
            subprocess.run(["sudo", "systemctl", "restart", "owntone.service"], timeout=8)
        except Exception as e:
            print(f"[AnalogAir Web] Error restarting owntone: {e}", flush=True)

    await loop.run_in_executor(None, _restart_pipeline)

    # Allow OwnTone 1.5s to rebind sockets, then ensure marked speakers and playback resume
    async def _post_restart_resume():
        await asyncio.sleep(1.8)
        fav_ids = set()
        with get_db() as conn:
            for row in conn.execute("SELECT output_id FROM favorite_speakers"):
                favs_id = str(row["output_id"])
                fav_ids.add(favs_id)
        if fav_ids:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"{OWNTONE_BASE}/api/outputs", timeout=3) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for o in data.get("outputs", []):
                                oid = str(o.get("id"))
                                if oid in fav_ids:
                                    await session.put(f"{OWNTONE_BASE}/api/outputs/{oid}", json={"selected": True, "volume": 100}, timeout=2)
            except Exception as err:
                print(f"[AnalogAir Web] Post-purge speaker reconnect: {err}", flush=True)

        await ensure_owntone_playing()

    asyncio.create_task(_post_restart_resume())
    return web.json_response({"success": True, "message": "Stream restarted in real-time."})

async def get_owntone_player(request):
    """Returns current OwnTone player state."""
    state = "unknown"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{OWNTONE_BASE}/api/player", timeout=2) as r:
                if r.status == 200:
                    data = await r.json()
                    state = data.get("state", "unknown")
                    return web.json_response({"success": True, "state": state, "data": data})
    except Exception:
        pass
    return web.json_response({"success": False, "state": state})

async def start_owntone_player(request):
    """Ensures OwnTone is in the play state, or toggles it to play."""
    action = "play"
    try:
        if request.can_read_body:
            body = await request.json()
            action = body.get("action", "play")
    except Exception:
        pass

    async with aiohttp.ClientSession() as session:
        try:
            curr_state = None
            async with session.get(f"{OWNTONE_BASE}/api/player", timeout=2) as r:
                if r.status == 200:
                    curr_state = (await r.json()).get("state")
            
            if action == "toggle" and curr_state == "play":
                async with session.put(f"{OWNTONE_BASE}/api/player/pause", timeout=2):
                    return web.json_response({"success": True, "state": "pause"})
            else:
                await ensure_owntone_playing()
                return web.json_response({"success": True, "state": "play"})
        except Exception:
            await ensure_owntone_playing()
            return web.json_response({"success": True, "state": "play"})

async def stream_owntone_mp3(request):
    """Proxies the live OwnTone MP3 stream directly through AnalogAir web."""
    try:
        # Automatically make sure OwnTone is in the play state
        await ensure_owntone_playing()

        session = aiohttp.ClientSession()
        resp = await session.get(f"{OWNTONE_BASE}/stream.mp3", timeout=aiohttp.ClientTimeout(total=None, sock_connect=3))
        if resp.status != 200:
            await resp.release()
            await session.close()
            return web.Response(status=resp.status, text="OwnTone stream offline")

        response = web.StreamResponse(
            status=200,
            headers={
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            }
        )
        await response.prepare(request)

        try:
            async for chunk in resp.content.iter_chunked(8192):
                await response.write(chunk)
        except (asyncio.CancelledError, ConnectionResetError):
            pass
        finally:
            await resp.release()
            await session.close()
        return response
    except Exception as e:
        return web.Response(status=503, text=f"Stream error: {e}")

async def toggle_owntone_output(request):
    output_id = request.match_info["id"]
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(f"{OWNTONE_BASE}/api/outputs", timeout=2) as r1:
                if r1.status == 200:
                    data = await r1.json()
                    found = next((o for o in data.get("outputs", []) if str(o.get("id")) == str(output_id)), None)
                    if found:
                        new_state = not found.get("selected", False)
                        payload = {"selected": new_state}
                        if new_state:
                            payload["volume"] = 100
                        async with session.put(f"{OWNTONE_BASE}/api/outputs/{output_id}", json=payload, timeout=2) as r2:
                            if r2.status == 200:
                                res_data = await r2.json()
                                if new_state:
                                    # Speaker selected: make sure OwnTone starts playing the stream if paused or stopped
                                    asyncio.create_task(ensure_owntone_playing())
                                return web.json_response({"output": res_data, "playbackEnsured": new_state})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"error": "Failed to toggle output"}, status=500)

async def set_owntone_output_volume(request):
    output_id = request.match_info["id"]
    body = await request.json()
    vol = body.get("volume", 100)
    async with aiohttp.ClientSession() as session:
        try:
            async with session.put(f"{OWNTONE_BASE}/api/outputs/{output_id}", json={"volume": vol}, timeout=2) as resp:
                if resp.status == 200:
                    res_data = await resp.json()
                    return web.json_response({"output": res_data})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    return web.json_response({"error": "Failed to set volume"}, status=500)

# --- 4. MusicBrainz & iTunes Search Proxies ---
async def search_itunes(request):
    query = (request.query.get("query") or "").strip()
    artist = (request.query.get("artist") or "").strip()
    album = (request.query.get("album") or "").strip()
    track = (request.query.get("track") or "").strip()

    def norm(s):
        if not s:
            return ""
        return re.sub(r"[^a-z0-9 ]", "", s.lower().replace("colour", "color")).strip()

    search_terms = [t for t in [
        f"{artist} {album}".strip() if (artist and album) else "",
        f"{artist} {track}".strip() if (artist and track) else "",
        album,
        artist if (artist and not album and not track) else "",
        query
    ] if t and t.strip()]

    if not search_terms:
        return web.json_response({"results": []})

    results = []
    seen_cids = set()
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    async with aiohttp.ClientSession() as session:
        for term in search_terms:
            try:
                url = f"https://itunes.apple.com/search?term={urllib.parse.quote(term)}&entity=album&limit=8"
                async with session.get(url, headers=headers, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for item in data.get("results", []):
                            cid = str(item.get("collectionId"))
                            if cid in seen_cids:
                                continue
                            seen_cids.add(cid)
                            art100 = item.get("artworkUrl100", "")
                            art1400 = art100.replace("100x100bb", "1400x1400bb") if art100 else ""
                            results.append({
                                "album": sanitize_album_title(item.get("collectionName", "")),
                                "artist": item.get("artistName", ""),
                                "releaseDate": item.get("releaseDate", "")[:4] if item.get("releaseDate") else "",
                                "trackCount": item.get("trackCount", 0),
                                "artworkUrl": art1400
                            })
            except Exception as e:
                print(f"[AnalogAir Web] iTunes search error: {e}", flush=True)

    norm_artist = norm(artist)
    norm_album = norm(album)

    def score_art(item):
        s = 0
        a_art = norm(item.get("artist", ""))
        a_alb = norm(item.get("album", ""))
        if norm_artist:
            if a_art == norm_artist:
                s += 100
            elif norm_artist in a_art or a_art in norm_artist:
                s += 50
        if norm_album:
            if a_alb == norm_album:
                s += 80
            elif norm_album in a_alb or a_alb in norm_album:
                s += 40
        if not re.search(r"greatest hits|best of|anthology", a_alb, re.IGNORECASE):
            s += 20
        return s

    results.sort(key=score_art, reverse=True)
    return web.json_response({"results": results[:15]})

async def search_musicbrainz(request):
    query = (request.query.get("query") or "").strip()
    artist = (request.query.get("artist") or "").strip()
    album = (request.query.get("album") or "").strip()
    recording = (request.query.get("recording") or request.query.get("track") or "").strip()

    if not query and not artist and not album and not recording:
        return web.json_response({"candidates": [], "likelyArtists": [], "categorized": {"studio": [], "compilations": [], "live": [], "singles": []}})

    def norm(s):
        if not s:
            return ""
        s = s.lower().replace("colours", "color").replace("colour", "color").replace("colors", "color")
        s = re.sub(r"\btheatres?\b", "theater", s)
        s = re.sub(r"^(the|a|an)\b\s*", "", s)
        return re.sub(r"[^a-z0-9 ]", "", s).strip()

    norm_target_artist = norm(artist)
    norm_target_album = norm(album)
    norm_target_rec = norm(recording)

    def calculate_score(c):
        s = 0
        c_art = norm(c.get("artist", ""))
        c_alb = norm(c.get("title", ""))

        if norm_target_artist:
            if norm_target_artist == c_art:
                s += 200
            elif norm_target_artist in c_art or c_art in norm_target_artist:
                s += 120
            else:
                s -= 150

        if norm_target_album:
            sim = difflib.SequenceMatcher(None, norm_target_album, c_alb).ratio()
            if norm_target_album == c_alb:
                s += 250
            elif norm_target_album in c_alb or c_alb in norm_target_album:
                s += 150
            elif sim >= 0.60:
                s += int(sim * 160)

        if norm_target_rec and c.get("sideOpener"):
            if "Track 1" in c.get("sideOpener", ""):
                s += 220
            else:
                s += 40
        elif "Track 1" in c.get("sideOpener", ""):
            s += 70

        if c.get("isFullAlbum"):
            s += 60
        if c.get("isCompilation"):
            s -= 30
            if norm_target_rec and "Track 1" not in c.get("sideOpener", ""):
                s -= 50
        if c.get("isLive"):
            s -= 40

        return s

    headers = {"User-Agent": "AnalogAir/1.2.0 ( contact@analogair.local; Distearth@gmail.com )"}
    all_candidates_map = {}
    likely_artists = []

    try:
        async with aiohttp.ClientSession() as session:
            # 1. Discover Likely Artists
            artist_term = artist or query
            if artist_term:
                try:
                    art_url = f"https://itunes.apple.com/search?term={urllib.parse.quote(artist_term)}&entity=musicArtist&limit=6"
                    async with session.get(art_url, headers=headers, timeout=5) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for item in data.get("results", []):
                                likely_artists.append({
                                    "id": str(item.get("artistId")),
                                    "name": item.get("artistName"),
                                    "genre": item.get("primaryGenreName") or "Music",
                                    "source": "itunes"
                                })
                except Exception:
                    pass

            # 2. Artist Discography Lookup (Categorized studio, compilations, live)
            primary_aid = likely_artists[0]["id"] if likely_artists else None
            if primary_aid:
                try:
                    disc_url = f"https://itunes.apple.com/lookup?id={primary_aid}&entity=album&limit=50"
                    async with session.get(disc_url, headers=headers, timeout=6) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for item in data.get("results", []):
                                if item.get("wrapperType") != "collection":
                                    continue
                                cid = str(item.get("collectionId"))
                                coll_name = sanitize_album_title(item.get("collectionName", ""))
                                is_live = bool(re.search(r"live|bootleg|concert|odeon|bbc", coll_name, re.IGNORECASE))
                                is_comp = bool(re.search(r"greatest hits|best of|anthology|collection|essential|very best|singles", coll_name, re.IGNORECASE))
                                is_single = bool(re.search(r" - single| - ep", coll_name, re.IGNORECASE) or (item.get("trackCount", 0) <= 3))
                                art100 = item.get("artworkUrl100") or ""

                                all_candidates_map[f"itunes-{cid}"] = {
                                    "id": f"itunes-{cid}",
                                    "collectionId": item.get("collectionId"),
                                    "title": coll_name,
                                    "artist": item.get("artistName", artist),
                                    "year": item.get("releaseDate", "")[:4] if item.get("releaseDate") else "Release",
                                    "format": '12" Vinyl LP',
                                    "isFullAlbum": not is_live and not is_comp and not is_single,
                                    "isCompilation": is_comp,
                                    "isLive": is_live,
                                    "isSingle": is_single,
                                    "typeLabel": "Studio Album (Canonical)" if (not is_live and not is_comp and not is_single) else ("Compilation" if is_comp else ("Live Recording" if is_live else "Single / EP")),
                                    "trackCount": item.get("trackCount", 0),
                                    "artUrl": art100.replace("100x100bb", "1400x1400bb") if art100 else "",
                                    "sideOpener": ""
                                }
                except Exception:
                    pass

            # 3. Targeted Album Search on iTunes
            album_terms = [t for t in [
                f"{artist} {album}".strip() if (artist and album) else "",
                f"{artist} {recording}".strip() if (artist and recording) else "",
                album,
                query
            ] if t and t.strip()]

            for alb_term in album_terms:
                try:
                    url = f"https://itunes.apple.com/search?term={urllib.parse.quote(alb_term)}&entity=album&limit=10"
                    async with session.get(url, headers=headers, timeout=5) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for item in data.get("results", []):
                                cid = str(item.get("collectionId"))
                                if f"itunes-{cid}" not in all_candidates_map:
                                    coll_name = sanitize_album_title(item.get("collectionName", ""))
                                    is_live = bool(re.search(r"live|bootleg|concert", coll_name, re.IGNORECASE))
                                    is_comp = bool(re.search(r"greatest hits|best of|anthology|collection", coll_name, re.IGNORECASE))
                                    is_single = bool(re.search(r" - single| - ep", coll_name, re.IGNORECASE) or (item.get("trackCount", 0) <= 3))
                                    art100 = item.get("artworkUrl100", "")
                                    all_candidates_map[f"itunes-{cid}"] = {
                                        "id": f"itunes-{cid}",
                                        "collectionId": item.get("collectionId"),
                                        "title": coll_name,
                                        "artist": item.get("artistName", artist),
                                        "year": item.get("releaseDate", "")[:4] if item.get("releaseDate") else "Release",
                                        "format": '12" Vinyl LP',
                                        "isFullAlbum": not is_live and not is_comp and not is_single,
                                        "isCompilation": is_comp,
                                        "isLive": is_live,
                                        "isSingle": is_single,
                                        "typeLabel": "Studio Album (Canonical)" if (not is_live and not is_comp and not is_single) else ("Compilation" if is_comp else ("Live Recording" if is_live else "Single / EP")),
                                        "trackCount": item.get("trackCount", 0),
                                        "artUrl": art100.replace("100x100bb", "1400x1400bb") if art100 else "",
                                        "sideOpener": ""
                                    }
                except Exception:
                    pass

            # 4. Search Song to match Track 1 Side A Opener
            song_terms = [t for t in [
                f"{artist} {recording}".strip() if (artist and recording) else "",
                recording
            ] if t and t.strip()]

            for song_term in song_terms:
                try:
                    url_song = f"https://itunes.apple.com/search?term={urllib.parse.quote(song_term)}&entity=song&limit=15"
                    async with session.get(url_song, headers=headers, timeout=5) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            for item in data.get("results", []):
                                t_num = item.get("trackNumber", 99)
                                is_track_one = (t_num == 1)
                                coll_name = sanitize_album_title(item.get("collectionName", ""))
                                is_live = bool(re.search(r"live", coll_name, re.IGNORECASE) or re.search(r"live", item.get("trackName", ""), re.IGNORECASE))
                                is_comp = bool(re.search(r"greatest hits|best of|anthology", coll_name, re.IGNORECASE))
                                art100 = item.get("artworkUrl100", "")
                                norm_coll = norm(coll_name)

                                existing = next((c for c in all_candidates_map.values() if norm(c["title"]) == norm_coll), None)
                                if existing:
                                    if is_track_one:
                                        existing["sideOpener"] = f"Track 1 (Side A Opener: {item.get('trackName')})"
                                    elif not existing.get("sideOpener") and t_num < 20:
                                        existing["sideOpener"] = f"Track {t_num} ({item.get('trackName')})"
                                    if item.get("trackCount"):
                                        existing["trackCount"] = item.get("trackCount")
                                    if not existing.get("artUrl") and art100:
                                        existing["artUrl"] = art100.replace("100x100bb", "1400x1400bb")
                                else:
                                    all_candidates_map[f"itunes-song-{item.get('collectionId')}"] = {
                                        "id": f"itunes-song-{item.get('collectionId')}",
                                        "collectionId": item.get("collectionId"),
                                        "title": coll_name,
                                        "artist": item.get("artistName", ""),
                                        "year": item.get("releaseDate", "")[:4] if item.get("releaseDate") else "Release",
                                        "format": '12" Vinyl LP',
                                        "isFullAlbum": not is_live and not is_comp,
                                        "isCompilation": is_comp,
                                        "isLive": is_live,
                                        "isSingle": False,
                                        "sideOpener": f"Track 1 (Side A Opener: {item.get('trackName')})" if is_track_one else f"Track {t_num} ({item.get('trackName')})",
                                        "typeLabel": "Studio Album (Canonical)" if (not is_live and not is_comp) else ("Compilation" if is_comp else "Live Recording"),
                                        "trackCount": item.get("trackCount", 0),
                                        "artUrl": art100.replace("100x100bb", "1400x1400bb") if art100 else ""
                                    }
                except Exception:
                    pass

            # 5. MusicBrainz release groups (with safe rate-limiting)
            if artist or album:
                try:
                    art_clause = f'artist:"{artist}" AND ' if artist else ""
                    alb_clause = f'releasegroupaccent:"{album}"' if album else "primarytype:album"
                    mb_url = f"https://musicbrainz.org/ws/2/release-group?query={urllib.parse.quote(art_clause + alb_clause)}&fmt=json&limit=10"
                    async with session.get(mb_url, headers=headers, timeout=5) as resp:
                        if resp.status == 200:
                            mb_data = await resp.json()
                            for rg in mb_data.get("release-groups", []):
                                rgid = rg.get("id")
                                rg_title = sanitize_album_title(rg.get("title", ""))
                                p_type = rg.get("primary-type") or "Album"
                                s_types = rg.get("secondary-types") or []
                                is_full_album = (p_type == "Album" and len(s_types) == 0)
                                is_comp = (p_type == "Compilation" or "Compilation" in s_types)
                                is_live = "Live" in s_types
                                year = (rg.get("first-release-date") or "")[:4] or "Release"

                                norm_rg = norm(rg_title)
                                matched_itunes = next((c for c in all_candidates_map.values() if norm(c["title"]) == norm_rg), None)
                                fb_art = matched_itunes.get("artUrl") if matched_itunes else f"https://coverartarchive.org/release-group/{rgid}/front-500"

                                all_candidates_map[f"mb-{rgid}"] = {
                                    "id": f"mb-{rgid}",
                                    "releaseGroupMbid": rgid,
                                    "title": rg_title,
                                    "artist": (rg.get("artist-credit") or [{}])[0].get("name") or artist,
                                    "year": year,
                                    "format": '12" Vinyl LP',
                                    "isFullAlbum": is_full_album,
                                    "isCompilation": is_comp,
                                    "isLive": is_live,
                                    "isSingle": p_type in ("Single", "EP"),
                                    "typeLabel": "Studio Album (Canonical)" if is_full_album else ("Compilation" if is_comp else ("Live Recording" if is_live else p_type)),
                                    "artUrl": fb_art,
                                    "sideOpener": matched_itunes.get("sideOpener") if matched_itunes else ""
                                }
                except Exception:
                    pass
    except Exception:
        pass

    all_candidates = list(all_candidates_map.values())
    for c in all_candidates:
        c["score"] = calculate_score(c)
    all_candidates.sort(key=lambda x: x["score"], reverse=True)

    studio = [c for c in all_candidates if c.get("isFullAlbum") and not c.get("isSingle")]
    compilations = [c for c in all_candidates if c.get("isCompilation")]
    live = [c for c in all_candidates if c.get("isLive")]
    singles = [c for c in all_candidates if c.get("isSingle")]

    return web.json_response({
        "candidates": all_candidates[:24],
        "likelyArtists": likely_artists,
        "categorized": {
            "studio": studio[:20],
            "compilations": compilations[:15],
            "live": live[:10],
            "singles": singles[:10]
        }
    })

# --- 4.1 Album Tracks & Side Opener Inspection ---
async def get_album_tracks(request):
    coll_id = request.query.get("collectionId")
    artist = request.query.get("artist", "").strip()
    album = request.query.get("album", "").strip()
    headers = {"User-Agent": "Mozilla/5.0"}

    try:
        async with aiohttp.ClientSession() as session:
            if not coll_id and (artist or album):
                q = urllib.parse.quote(f"{artist} {album}".strip())
                async with session.get(f"https://itunes.apple.com/search?term={q}&entity=album&limit=1", headers=headers, timeout=5) as r:
                    if r.status == 200:
                        d = await r.json()
                        if d.get("results"):
                            coll_id = str(d["results"][0].get("collectionId"))

            if not coll_id:
                return web.json_response({"tracks": [], "sideAOpener": None, "sideBOpener": None})

            async with session.get(f"https://itunes.apple.com/lookup?id={coll_id}&entity=song", headers=headers, timeout=5) as r:
                if r.status == 200:
                    d = await r.json()
                    songs = [x for x in d.get("results", []) if x.get("wrapperType") == "track"]
                    total = len(songs)
                    side_b_start = (total // 2) + 1 if total % 2 == 0 else (total // 2) + 2
                    tracks = []
                    for s in songs:
                        t_num = s.get("trackNumber", 1)
                        is_side_a = t_num < side_b_start
                        side = "A" if is_side_a else "B"
                        is_opener = (t_num == 1 or t_num == side_b_start)
                        dur_sec = (s.get("trackTimeMillis") or 0) // 1000
                        mins = dur_sec // 60
                        secs = str(dur_sec % 60).zfill(2)
                        tracks.append({
                            "trackNumber": t_num,
                            "title": s.get("trackName"),
                            "duration": f"{mins}:{secs}",
                            "side": side,
                            "isOpener": is_opener,
                            "openerLabel": "Side A Opener" if t_num == 1 else ("Side B Opener" if t_num == side_b_start else "")
                        })

                    side_a = next((t["title"] for t in tracks if t["trackNumber"] == 1), None)
                    side_b = next((t["title"] for t in tracks if t["trackNumber"] == side_b_start), None)

                    return web.json_response({
                        "collectionId": coll_id,
                        "totalTracks": total,
                        "sideAOpener": side_a,
                        "sideBOpener": side_b,
                        "tracks": tracks
                    })
    except Exception:
        pass

    return web.json_response({"tracks": [], "sideAOpener": None, "sideBOpener": None})

# --- 5. Overrides & Custom Metadata ---
async def get_overrides(request):
    overrides = []
    with get_db() as conn:
        for row in conn.execute("SELECT track_key, custom_artist, custom_album, custom_art_url, release_mbid, format, year, updated_at FROM release_overrides"):
            overrides.append({
                "trackKey": row["track_key"],
                "customArtist": row["custom_artist"],
                "customAlbum": row["custom_album"],
                "customArtUrl": row["custom_art_url"],
                "releaseMbid": row["release_mbid"],
                "format": row["format"] or '12" Vinyl LP',
                "year": row["year"] or '',
                "updatedAt": row["updated_at"]
            })
    return web.json_response({"overrides": overrides})

async def save_override(request):
    data = await request.json()
    track_key = data.get("trackKey")
    custom_album = data.get("customAlbum")
    if not track_key or not custom_album:
        return web.json_response({"error": "trackKey and customAlbum are required"}, status=400)

    custom_artist = data.get("customArtist", "")
    custom_art_url = data.get("customArtUrl")
    release_mbid = data.get("releaseMbid")
    fmt = data.get("format", '12" Vinyl LP')
    year = data.get("year", "")
    opener_track = (data.get("openerTrack") or data.get("opener_track") or "").strip()

    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO release_overrides 
            (track_key, custom_artist, custom_album, custom_art_url, release_mbid, format, year, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (track_key, custom_artist, custom_album, custom_art_url, release_mbid, fmt, year))

        # Also store under opener key for guaranteed track 1 / side opener matching
        if opener_track and custom_artist:
            opener_key = f"{custom_artist} - {opener_track}"
            conn.execute("""
                INSERT OR REPLACE INTO release_overrides 
                (track_key, custom_artist, custom_album, custom_art_url, release_mbid, format, year, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            """, (opener_key, custom_artist, custom_album, custom_art_url, release_mbid, fmt, year))

        conn.execute("""
            UPDATE sessions SET album=?, artist=?, art_url=?, has_override=1
            WHERE (artist || ' - ' || first_track) = ?
        """, (custom_album, custom_artist or "Unknown", custom_art_url, track_key))
        conn.commit()

    # Update active /tmp/analogair_state.json if matching
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r") as f:
                st = json.load(f)
            current_key = f"{st.get('artist', '')} - {st.get('title', '')}"
            if current_key == track_key or st.get("artist") == custom_artist:
                st["album"] = custom_album
                if custom_artist:
                    st["artist"] = custom_artist
                if custom_art_url:
                    st["artUrl"] = custom_art_url
                if release_mbid:
                    st["mbid"] = release_mbid
                st["matched_via"] = "local_override"
                with open(STATE_FILE, "w") as f:
                    json.dump(st, f)
        except Exception:
            pass

    # Save artwork to AnalogAir.jpg
    if custom_art_url:
        try:
            PIPE_DIR.mkdir(parents=True, exist_ok=True)
            if custom_art_url.startswith("data:image"):
                b64_data = custom_art_url.split(",", 1)[1] if "," in custom_art_url else custom_art_url
                with open(LIVE_ART_PATH, "wb") as f:
                    f.write(base64.b64decode(b64_data))
            elif custom_art_url.startswith("http"):
                async with aiohttp.ClientSession() as session:
                    async with session.get(custom_art_url, timeout=5) as resp:
                        if resp.status == 200:
                            content = await resp.read()
                            with open(LIVE_ART_PATH, "wb") as f:
                                f.write(content)
        except Exception as e:
            print(f"[AnalogAir Web] Error saving override art: {e}", flush=True)

    # Push to metadata pipe
    title = ""
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r") as f:
                st = json.load(f)
                title = st.get("title", "")
        except Exception:
            pass
    write_to_metadata_pipe(title or "Vinyl Stream", custom_artist or "Unknown Artist", custom_album)

    record = {
        "trackKey": track_key,
        "customArtist": custom_artist,
        "customAlbum": custom_album,
        "customArtUrl": custom_art_url,
        "releaseMbid": release_mbid,
        "format": fmt,
        "year": year,
        "updatedAt": datetime.now().isoformat()
    }
    return web.json_response({"success": True, "record": record})

async def delete_override(request):
    key = urllib.parse.unquote(request.match_info.get("key", ""))
    with get_db() as conn:
        conn.execute("DELETE FROM release_overrides WHERE track_key=?", (key,))
        conn.commit()
    return web.json_response({"success": True})

# --- 6. Sessions & History ---
async def get_sessions(request):
    sessions = []
    with get_db() as conn:
        for row in conn.execute("SELECT id, artist, album, first_track, art_url, played_at, play_count, mbid, has_override FROM sessions ORDER BY played_at DESC LIMIT 30"):
            sessions.append({
                "id": row["id"],
                "artist": row["artist"],
                "album": row["album"],
                "firstTrack": row["first_track"],
                "artUrl": row["art_url"],
                "playedAt": row["played_at"],
                "playCount": row["play_count"],
                "mbid": row["mbid"],
                "hasOverride": bool(row["has_override"])
            })
    return web.json_response({"sessions": sessions})

async def delete_session(request):
    sess_id = request.match_info.get("id", "")
    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE id=?", (sess_id,))
        conn.commit()
    return web.json_response({"success": True})

# --- 7. Settings Management ---
async def get_settings(request):
    settings = {}
    with get_db() as conn:
        for row in conn.execute("SELECT key, value FROM settings"):
            settings[row["key"]] = row["value"]

    return web.json_response({
        "settings": {
            "sourceType": settings.get("source_type", "vinyl"),
            "customStreamLabel": "AnalogAir Vinyl",
            "defaultArtUrl": "/api/artwork/custom-standby.jpg",
            "idleArtist": settings.get("idle_artist", "Audio-Technica"),
            "idleAlbum": settings.get("idle_album", "AT-LP60X Turntable"),
            "idleTitle": settings.get("idle_title", "AnalogAir Vinyl"),
            "enableRecognition": settings.get("enable_recognition", "false").lower() == "true",
            "continuousId": settings.get("continuous_id", "false").lower() == "true",
            "silenceGapSeconds": int(settings.get("silence_gap", 15)),
            "sampleDuration": int(settings.get("sample_duration", 10)),
            "dimMinutes": int(settings.get("dim_minutes", 25)),
            "idleFadeSeconds": int(settings.get("idle_fade_seconds", 10)),
            "owntoneHost": settings.get("owntone_host", "localhost"),
            "owntonePort": int(settings.get("owntone_port", 3689)),
            "enableToneDsp": settings.get("enable_tone_dsp", "true").lower() == "true"
        }
    })

async def save_settings(request):
    data = await request.json()
    with get_db() as conn:
        mapping = {
            "sourceType": "source_type",
            "idleArtist": "idle_artist",
            "idleAlbum": "idle_album",
            "idleTitle": "idle_title",
            "enableRecognition": "enable_recognition",
            "continuousId": "continuous_id",
            "silenceGapSeconds": "silence_gap",
            "sampleDuration": "sample_duration",
            "dimMinutes": "dim_minutes",
            "idleFadeSeconds": "idle_fade_seconds",
            "owntoneHost": "owntone_host",
            "owntonePort": "owntone_port",
            "enableToneDsp": "enable_tone_dsp"
        }
        for client_k, db_k in mapping.items():
            if client_k in data:
                conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (db_k, str(data[client_k])))
        conn.commit()

    if "defaultArtUrl" in data:
        try:
            if DEFAULT_ART_PATH.exists():
                shutil.copyfile(DEFAULT_ART_PATH, LIVE_ART_PATH)
        except Exception:
            pass

    return web.json_response({"success": True, "settings": data})

# --- 7b. System Power Management ---
async def handle_system_power(request):
    try:
        data = await request.json()
        action = data.get("action", "shutdown")
        if action == "shutdown":
            print("[AnalogAir Web] Immediate shutdown requested. Halting system cleanly...", flush=True)
            subprocess.Popen(["sudo", "systemctl", "poweroff"])
            return web.json_response({"success": True, "message": "System shutdown initiated."})
        elif action == "reboot":
            print("[AnalogAir Web] Reboot requested. Restarting system cleanly...", flush=True)
            subprocess.Popen(["sudo", "systemctl", "reboot"])
            return web.json_response({"success": True, "message": "System reboot initiated."})
        return web.json_response({"error": "Invalid action"}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# --- 8. Artwork Serving & Upload ---
NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
}

def ensure_default_artwork():
    """Generates guaranteed 1000x1000 high-resolution vinyl standby artwork if missing."""
    if DEFAULT_ART_PATH.exists() and DEFAULT_ART_PATH.stat().st_size > 500:
        return True
    try:
        PIPE_DIR.mkdir(parents=True, exist_ok=True)
        from PIL import Image, ImageDraw
        img = Image.new('RGB', (1000, 1000), color='#121216')
        draw = ImageDraw.Draw(img)
        # Concentric vinyl record grooves
        for r in range(120, 460, 18):
            draw.ellipse([500 - r, 500 - r, 500 + r, 500 + r], outline='#1e1e26', width=2)
        # Outer boundary ring
        draw.ellipse([80, 80, 920, 920], outline='#2a2a34', width=8)
        # Gold/amber record label
        draw.ellipse([340, 340, 660, 660], fill='#d97706', outline='#b45309', width=6)
        # Inner spindle hole
        draw.ellipse([475, 475, 525, 525], fill='#0e0e12')
        img.save(str(DEFAULT_ART_PATH), 'JPEG', quality=90)
        if not LIVE_ART_PATH.exists() or LIVE_ART_PATH.stat().st_size <= 500:
            shutil.copyfile(str(DEFAULT_ART_PATH), str(LIVE_ART_PATH))
        return True
    except Exception as e:
        print(f"[AnalogAir Web] Note: Could not generate default artwork via PIL ({e})", flush=True)
        return False

async def serve_current_art(request):
    if not LIVE_ART_PATH.exists() or LIVE_ART_PATH.stat().st_size <= 500:
        ensure_default_artwork()
    if LIVE_ART_PATH.exists() and LIVE_ART_PATH.stat().st_size > 500:
        return web.FileResponse(LIVE_ART_PATH, headers=NO_CACHE_HEADERS)
    return await serve_standby_art(request)

async def serve_standby_art(request):
    if not DEFAULT_ART_PATH.exists() or DEFAULT_ART_PATH.stat().st_size <= 500:
        ensure_default_artwork()
    if DEFAULT_ART_PATH.exists() and DEFAULT_ART_PATH.stat().st_size > 500:
        return web.FileResponse(DEFAULT_ART_PATH, headers=NO_CACHE_HEADERS)
    if LIVE_ART_PATH.exists() and LIVE_ART_PATH.stat().st_size > 500:
        return web.FileResponse(LIVE_ART_PATH, headers=NO_CACHE_HEADERS)
    for fallback in [
        UI_DIR / "assets" / "default_vinyl.jpg",
        UI_DIR / "assets" / "default_idle.jpg",
        FALLBACK_ART_PATH,
        FALLBACK_SRC_ART
    ]:
        if fallback.exists() and fallback.stat().st_size > 500:
            return web.FileResponse(fallback, headers=NO_CACHE_HEADERS)
    return web.Response(status=404)

async def serve_live_pipe_art(request):
    if LIVE_ART_PATH.exists():
        return web.FileResponse(LIVE_ART_PATH, headers=NO_CACHE_HEADERS)
    return await serve_standby_art(request)

async def upload_default_art(request):
    try:
        PIPE_DIR.mkdir(parents=True, exist_ok=True)
        if request.content_type == "application/json":
            body = await request.json()
            image_b64 = body.get("imageBase64", "")
            if not image_b64:
                return web.json_response({"error": "No image data provided"}, status=400)
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]
            raw_bytes = base64.b64decode(image_b64)
            with open(DEFAULT_ART_PATH, "wb") as f:
                f.write(raw_bytes)
            shutil.copyfile(DEFAULT_ART_PATH, LIVE_ART_PATH)
            return web.json_response({"success": True, "artUrl": "/api/artwork/custom-standby.jpg"})
        elif request.content_type.startswith("multipart/"):
            reader = await request.multipart()
            field = await reader.next()
            if field and field.name in ['file', 'image']:
                with open(DEFAULT_ART_PATH, 'wb') as f:
                    while True:
                        chunk = await field.read_chunk()
                        if not chunk:
                            break
                        f.write(chunk)
                shutil.copyfile(DEFAULT_ART_PATH, LIVE_ART_PATH)
                return web.json_response({"success": True, "artUrl": "/api/artwork/custom-standby.jpg"})
            return web.json_response({"error": "No file in multipart form"}, status=400)
        else:
            return web.json_response({"error": "Unsupported Content-Type"}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

# --- 9. Installer & Downloadable Artifacts ---
async def download_desktop_shortcut(request):
    host = request.headers.get("Host", "localhost:3000")
    desktop_content = f"""[Desktop Entry]
Version=1.0
Type=Application
Name=Install AnalogAir
Comment=Run AnalogAir Zero-Latency Vinyl Audio Streamer Installer
Exec=bash -c "curl -sSL http://{host}/api/installer/script | bash; echo ''; echo 'Press Enter to finish...'; read -r"
Icon=audio-card
Terminal=true
Categories=Audio;AudioVideo;
StartupNotify=true
"""
    return web.Response(
        text=desktop_content,
        content_type="application/x-desktop",
        headers={"Content-Disposition": 'attachment; filename="Install-AnalogAir.desktop"'}
    )

async def download_install_script(request):
    if INSTALL_SH_PATH.exists():
        return web.FileResponse(
            INSTALL_SH_PATH,
            headers={"Content-Disposition": 'attachment; filename="install.sh"'}
        )
    return web.Response(text="#!/bin/bash\necho 'install.sh not found'\n", content_type="text/x-shellscript")

async def download_update_script(request):
    if UPDATE_SH_PATH.exists():
        return web.FileResponse(
            UPDATE_SH_PATH,
            headers={"Content-Disposition": 'attachment; filename="update.sh"'}
        )
    return web.Response(text="#!/bin/bash\necho 'update.sh not found'\n", content_type="text/x-shellscript")

async def download_daemon_script(request):
    if DAEMON_SCRIPT_PATH.exists():
        return web.FileResponse(
            DAEMON_SCRIPT_PATH,
            headers={"Content-Disposition": 'attachment; filename="analogair_daemon.py"'}
        )
    return web.Response(status=404)

async def download_web_script(request):
    if WEB_SCRIPT_PATH.exists():
        return web.FileResponse(
            WEB_SCRIPT_PATH,
            headers={"Content-Disposition": 'attachment; filename="analogair_web.py"'}
        )
    return web.Response(status=404)

# --- 11. Static & SPA Serving ---
async def serve_asset(request):
    filename = request.match_info.get("filename", "")
    target = UI_DIR / "assets" / filename
    if target.is_file():
        return web.FileResponse(target)
    # If the requested asset is an image (e.g. Vite-hashed image or default art), return standby artwork instead of 404
    if any(filename.lower().endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp", ".svg"]):
        return await serve_standby_art(request)
    return web.Response(status=404)

async def serve_index(request):
    index_file = UI_DIR / "index.html"
    if index_file.exists():
        return web.FileResponse(index_file)
    return web.Response(text="<h1>AnalogAir Server Running</h1><p>UI files not found. Check installation.</p>", content_type="text/html")

async def serve_static_or_spa(request):
    req_path = request.match_info.get("tail", "")
    target = UI_DIR / req_path
    if target.is_file():
        return web.FileResponse(target)
    return await serve_index(request)

# --- 12. Auto-Connect Startup Speakers ---
async def auto_connect_startup_speakers(app):
    for delay in [3, 5, 7]:
        await asyncio.sleep(delay)
        fav_ids = set()
        with get_db() as conn:
            try:
                conn.execute("CREATE TABLE IF NOT EXISTS favorite_speakers (speaker_id TEXT PRIMARY KEY)")
                for row in conn.execute("SELECT speaker_id FROM favorite_speakers"):
                    fav_ids.add(str(row["speaker_id"]))
            except Exception:
                pass

        if not fav_ids:
            break

        all_favs_active = True
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{OWNTONE_BASE}/api/outputs", timeout=3) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        outputs = data.get("outputs", [])
                        found_favs = set()
                        for o in outputs:
                            oid = str(o.get("id"))
                            if oid in fav_ids:
                                found_favs.add(oid)
                                if not o.get("selected", False):
                                    all_favs_active = False
                                    await session.put(f"{OWNTONE_BASE}/api/outputs/{oid}", json={"selected": True, "volume": 100}, timeout=2)
                                    print(f"[AnalogAir Web] Auto-connected startup speaker: {o.get('name')}", flush=True)
                        if fav_ids.issubset(found_favs) and all_favs_active:
                            await ensure_owntone_playing()
                            break
            except Exception as e:
                print(f"[AnalogAir Web] Speaker auto-connect check: {e}", flush=True)

        if fav_ids:
            await ensure_owntone_playing()

async def start_background_tasks(app):
    asyncio.create_task(auto_connect_startup_speakers(app))

def main():
    init_db()
    app = web.Application(client_max_size=30 * 1024 * 1024)
    app.on_startup.append(start_background_tasks)

    # 1. State & Playback Mode
    app.router.add_get('/api/state', get_state)
    app.router.add_post('/api/mode', toggle_mode)

    # 2. Tone DSP & Soundcard Hardware
    app.router.add_get('/api/tone', get_tone)
    app.router.add_post('/api/tone', save_tone)
    app.router.add_get('/api/audio-level', get_audio_level)

    # 3. OwnTone Multi-Room AirPlay Outputs
    app.router.add_get('/api/owntone/outputs', get_owntone_outputs)
    app.router.add_post('/api/owntone/outputs/{id}/toggle', toggle_owntone_output)
    app.router.add_post('/api/owntone/outputs/{id}/volume', set_owntone_output_volume)
    app.router.add_post('/api/owntone/outputs/{id}/favorite', toggle_favorite_output)
    app.router.add_get('/api/owntone/player', get_owntone_player)
    app.router.add_post('/api/owntone/player/play', start_owntone_player)
    app.router.add_post('/api/owntone/player/toggle', start_owntone_player)
    app.router.add_post('/api/owntone/purge-buffer', purge_owntone_buffer)
    app.router.add_get('/stream.mp3', stream_owntone_mp3)
    app.router.add_get('/api/stream.mp3', stream_owntone_mp3)

    # 4. Search & Overrides
    app.router.add_get('/api/search/musicbrainz', search_musicbrainz)
    app.router.add_get('/api/album-tracks', get_album_tracks)
    app.router.add_get('/api/search/itunes', search_itunes)
    app.router.add_get('/api/overrides', get_overrides)
    app.router.add_post('/api/override', save_override)
    app.router.add_delete('/api/override/{key}', delete_override)

    # 5. Sessions & History
    app.router.add_get('/api/sessions', get_sessions)
    app.router.add_delete('/api/sessions/{id}', delete_session)

    # 6. System Preferences & Settings
    app.router.add_get('/api/settings', get_settings)
    app.router.add_post('/api/settings', save_settings)
    app.router.add_post('/api/system/power', handle_system_power)

    # 7. Artwork Serving & Uploads
    app.router.add_get('/api/artwork/current.jpg', serve_current_art)
    app.router.add_get('/api/artwork/custom-standby.jpg', serve_standby_art)
    app.router.add_get('/api/artwork/AnalogAir.jpg', serve_live_pipe_art)
    app.router.add_post('/api/upload/default-art', upload_default_art)

    # 8. Downloadable Install & Update Artifacts
    app.router.add_get('/api/installer/desktop-shortcut', download_desktop_shortcut)
    app.router.add_get('/api/installer/script', download_install_script)
    app.router.add_get('/api/installer/update-script', download_update_script)
    app.router.add_get('/api/installer/daemon', download_daemon_script)
    app.router.add_get('/api/installer/web', download_web_script)

    # 10. Static assets with intelligent image failover
    app.router.add_get('/assets/{filename:.*}', serve_asset)
    assets_dir = UI_DIR / "assets"
    if assets_dir.exists():
        app.router.add_static('/assets', str(assets_dir))

    # 11. SPA Entry Point & Catch-All
    app.router.add_get('/', serve_index)
    app.router.add_get('/{tail:.*}', serve_static_or_spa)

    print("AnalogAir Web Server running on http://0.0.0.0:3000", flush=True)
    web.run_app(app, host='0.0.0.0', port=3000)

if __name__ == '__main__':
    main()
