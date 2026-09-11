#!/usr/bin/env python3
"""
AnalogAir Metadata & Cover Art Daemon
Handles Shazam audio recognition, MusicBrainz release group lookup,
SQLite override cache, and real-time AirPlay XML pipe updates.
"""
import asyncio
import base64
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys

# Python 3.13 audioop compatibility shim (PEP 594 removed audioop from stdlib)
try:
    import audioop
except ModuleNotFoundError:
    try:
        import audioop_lts as audioop
        sys.modules['audioop'] = audioop
    except ImportError:
        try:
            import pyaudioop as audioop
            sys.modules['audioop'] = audioop
        except ImportError:
            pass

import wave
import numpy as np
import requests
try:
    import sounddevice as sd
except Exception:
    sd = None
from shazamio import Shazam
import time
import signal
import io
from PIL import Image

HOME = os.path.expanduser("~")
DB_PATH = os.path.expanduser("~/.config/analogair/settings.db")
STATE_FILE = "/tmp/analogair_state.json"
PIPE_DIR = os.path.join(HOME, "Music/AnalogAir")
os.makedirs(PIPE_DIR, exist_ok=True)
DEFAULT_ART_PATH = os.path.join(PIPE_DIR, "AnalogAir_default.jpg")
LIVE_ART_PATH = os.path.join(PIPE_DIR, "AnalogAir.jpg")
PIPE_PATH = os.path.join(PIPE_DIR, "AnalogAir.metadata")
CACHE_DIR = "/tmp/analogair_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

DEFAULT_SILENCE_THRESHOLD = 0.0025
CHECK_INTERVAL = 4

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS release_overrides (
            track_key TEXT PRIMARY KEY,
            custom_artist TEXT,
            custom_album TEXT NOT NULL,
            custom_art_url TEXT,
            release_mbid TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            artist TEXT NOT NULL,
            album TEXT NOT NULL,
            first_track TEXT NOT NULL,
            art_url TEXT,
            played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            play_count INTEGER DEFAULT 1,
            mbid TEXT,
            has_override INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()

def get_setting(key, default=""):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT value FROM settings WHERE key=?", (key,))
        row = c.fetchone()
        conn.close()
        return row[0] if row else default
    except:
        return default

def get_override(track_key):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT custom_artist, custom_album, custom_art_url, release_mbid FROM release_overrides WHERE track_key=?", (track_key,))
        row = c.fetchone()
        conn.close()
        return row if row else None
    except:
        return None

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

def restore_default_artwork():
    if not os.path.exists(DEFAULT_ART_PATH) or os.path.getsize(DEFAULT_ART_PATH) < 500:
        try:
            img = Image.new('RGB', (1000, 1000), color='#121216')
            draw = ImageDraw.Draw(img)
            draw.ellipse([100, 100, 900, 900], outline='#2a2a32', width=8)
            draw.ellipse([250, 250, 750, 750], outline='#222228', width=6)
            draw.ellipse([400, 400, 600, 600], fill='#d97706')
            draw.ellipse([480, 480, 520, 520], fill='#121216')
            img.save(DEFAULT_ART_PATH, 'JPEG', quality=90)
        except Exception:
            pass

    if os.path.exists(DEFAULT_ART_PATH):
        try:
            shutil.copyfile(DEFAULT_ART_PATH, LIVE_ART_PATH)
        except Exception as e:
            print(f"Error restoring default art: {e}", flush=True)

def write_to_pipe(xml_data):
    if os.path.exists(PIPE_PATH):
        try:
            fd = os.open(PIPE_PATH, os.O_WRONLY | os.O_NONBLOCK)
            os.write(fd, xml_data.encode("utf-8"))
            os.close(fd)
        except OSError:
            pass

def encode_b64(text):
    return base64.b64encode(text.encode("utf-8")).decode("utf-8")

def make_xml(title, artist, album):
    return f"""<item><type>61727473</type><code>6173746e</code><data encoding="base64">{encode_b64(title)}</data></item>
<item><type>61727473</type><code>61736172</code><data encoding="base64">{encode_b64(artist)}</data></item>
<item><type>61727473</type><code>6173616c</code><data encoding="base64">{encode_b64(album)}</data></item>
"""

def update_artwork(artist, album, title=None, mbid=None, custom_art_url=None, fallback_art_url=None):
    """
    Fetches and saves high-resolution artwork to LIVE_ART_PATH.
    Uses multi-stage fallback (Custom override -> Shazam art -> iTunes Album -> iTunes Song -> MusicBrainz).
    Never throws away fallbacks if one candidate fails to download.
    """
    candidates = []
    if custom_art_url and str(custom_art_url).strip():
        candidates.append(("override", custom_art_url.strip()))

    if fallback_art_url and str(fallback_art_url).strip():
        candidates.append(("shazam", fallback_art_url.strip()))

    clean_album = sanitize_album_title(album) if album else ""
    idle_album = get_setting("idle_album", "AT-LP60X Turntable")
    has_valid_album = clean_album and clean_album.lower() not in (idle_album.lower(), "analogair vinyl", "unknown album")

    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

    # 1. Search iTunes by Album if album name is known and valid
    if has_valid_album and artist:
        try:
            q = requests.utils.quote(f"{artist} {clean_album}".strip())
            url = f"https://itunes.apple.com/search?term={q}&entity=album&limit=3"
            res = requests.get(url, headers=headers, timeout=6).json()
            for r in res.get("results", []):
                art = r.get("artworkUrl100", "")
                if art:
                    candidates.append(("itunes_album", art.replace("100x100bb", "1400x1400bb")))
                    break
        except Exception as e:
            print(f"[AnalogAir] iTunes album query error: {e}", flush=True)

    # 2. Search iTunes by Song (Artist + Track Title)
    if artist and title:
        try:
            clean_track = sanitize_track_title(title)
            q = requests.utils.quote(f"{artist} {clean_track}".strip())
            url = f"https://itunes.apple.com/search?term={q}&entity=song&limit=3"
            res = requests.get(url, headers=headers, timeout=6).json()
            for r in res.get("results", []):
                art = r.get("artworkUrl100", "")
                if art:
                    candidates.append(("itunes_song", art.replace("100x100bb", "1400x1400bb")))
                    break
        except Exception as e:
            print(f"[AnalogAir] iTunes song query error: {e}", flush=True)

    # 3. Search MusicBrainz CoverArtArchive if mbid is provided
    if mbid:
        candidates.append(("coverartarchive", f"https://coverartarchive.org/release/{mbid}/front-500"))

    # Try downloading candidates in priority order until one succeeds
    for source_name, url in candidates:
        try:
            if not url or not url.startswith("http"):
                continue
            resp = requests.get(url, headers=headers, timeout=8)
            if resp.status_code == 200 and len(resp.content) > 500:
                image = Image.open(io.BytesIO(resp.content))
                if image.mode in ("RGBA", "P", "LA"):
                    image = image.convert("RGB")
                os.makedirs(os.path.dirname(LIVE_ART_PATH), exist_ok=True)
                image.save(LIVE_ART_PATH, "JPEG", quality=92)
                print(f"[AnalogAir] Successfully updated live artwork from {source_name} ({len(resp.content)} bytes)", flush=True)
                return url
        except Exception as err:
            print(f"[AnalogAir] Candidate artwork failed ({source_name}: {url[:60]}...): {err}", flush=True)

    # If all new candidate sources failed: only restore default if live art doesn't exist
    if not os.path.exists(LIVE_ART_PATH) or os.path.getsize(LIVE_ART_PATH) < 500:
        restore_default_artwork()
    return None

def is_turntable_string(s):
    if not s:
        return True
    lower = s.lower().strip()
    return any(k in lower for k in ["turntable", "analogair", "idle", "unknown", "standby", "default"])

def resolve_canonical_vinyl_album(artist, title, candidate_album=None):
    """
    Identifies the definitive canonical studio album and vinyl side opener for a track.
    Distinguishes studio records from live bootlegs, greatest hits compilations, or idle strings.
    Gives a massive score boost to Track 1 (Side A / Side B openers).
    """
    if not artist or not title:
        return candidate_album, None, None

    clean_title = sanitize_track_title(title).split(" (")[0].split(" [")[0].strip()
    headers = {"User-Agent": "Mozilla/5.0"}
    best_album = candidate_album if (candidate_album and not is_turntable_string(candidate_album)) else None
    best_art = None
    best_mbid = None
    highest_score = -999

    # 1. Query iTunes Song Database to inspect tracklists & side openers
    try:
        q = requests.utils.quote(f"{artist} {clean_title}".strip())
        url = f"https://itunes.apple.com/search?term={q}&entity=song&limit=15"
        res = requests.get(url, headers=headers, timeout=5).json()
        for item in res.get("results", []):
            coll = sanitize_album_title(item.get("collectionName", ""))
            if not coll:
                continue
            t_num = item.get("trackNumber", 99)
            art = (item.get("artworkUrl100") or "").replace("100x100bb", "1400x1400bb")
            is_live = bool(re.search(r"live|bootleg|concert", coll, re.IGNORECASE) or re.search(r"live", item.get("trackName", ""), re.IGNORECASE))
            is_comp = bool(re.search(r"greatest hits|best of|anthology|singles", coll, re.IGNORECASE))

            score = 0
            # Side opener bonus (Track 1 is Side A opener)
            if t_num == 1:
                score += 50
            elif t_num in (2, 3, 4, 5, 6):
                score += 20

            # Studio album priority
            if not is_live and not is_comp:
                score += 35
            if is_live:
                score -= 45
            if is_comp:
                score -= 25

            # If candidate_album was provided and matches (and isn't idle/turntable)
            if candidate_album and not is_turntable_string(candidate_album):
                if coll.lower() in candidate_album.lower() or candidate_album.lower() in coll.lower():
                    score += 15

            if score > highest_score:
                highest_score = score
                best_album = coll
                best_art = art
    except Exception as e:
        print(f"[AnalogAir] iTunes vinyl album resolution error: {e}", flush=True)

    # 2. Query MusicBrainz Master Release Group if available
    try:
        mb_headers = {"User-Agent": "AnalogAir/1.2.0 ( contact@analogair.local; Distearth@gmail.com )"}
        # Find artist MBID using alias recovery
        art_q = requests.utils.quote(f'alias:"{artist}" OR artist:"{artist}"')
        a_url = f"https://musicbrainz.org/ws/2/artist?query={art_q}&fmt=json&limit=1"
        a_resp = requests.get(a_url, headers=mb_headers, timeout=4)
        if a_resp.status_code == 200:
            a_data = a_resp.json()
            artists = a_data.get("artists", [])
            if artists:
                arid = artists[0].get("id")
                target_search = best_album or candidate_album
                if target_search and not is_turntable_string(target_search):
                    rg_q = requests.utils.quote(f'arid:{arid} AND releasegroupaccent:"{target_search}" AND primarytype:album')
                    rg_url = f"https://musicbrainz.org/ws/2/release-group?query={rg_q}&fmt=json&limit=3"
                    rg_resp = requests.get(rg_url, headers=mb_headers, timeout=4)
                    if rg_resp.status_code == 200:
                        rg_data = rg_resp.json()
                        for rg in rg_data.get("release-groups", []):
                            rg_id = rg.get("id")
                            rg_title = sanitize_album_title(rg.get("title", ""))
                            p_type = rg.get("primary-type") or "Album"
                            s_types = rg.get("secondary-types") or []
                            if p_type == "Album" and not s_types:
                                best_album = rg_title
                                best_mbid = rg_id
                                caa_url = f"https://coverartarchive.org/release-group/{rg_id}/front-500"
                                if not best_art:
                                    best_art = caa_url
                                break
    except Exception:
        pass

    return best_album, best_art, best_mbid

def get_capture_target():
    """
    Finds the exact audio device target to record from.
    1. Settings DB
    2. User's systemd analogair-capture.service
    3. Auto-detected USB Audio CODEC / turntable source in PipeWire/Pulse
    """
    target = get_setting("audio_device", "").strip()
    if target and target != "@DEFAULT_SOURCE@":
        return target

    # Check systemd user capture service
    svc_path = os.path.expanduser("~/.config/systemd/user/analogair-capture.service")
    if os.path.exists(svc_path):
        try:
            with open(svc_path) as f:
                content = f.read()
                m = re.search(r"--target=([^\s]+)", content)
                if m:
                    val = m.group(1).strip()
                    if val and val != "@DEFAULT_SOURCE@":
                        return val
        except Exception:
            pass

    # Auto-detect via pactl
    if shutil.which("pactl"):
        try:
            out = subprocess.check_output(["pactl", "list", "sources", "short"], text=True, timeout=2)
            for line in out.splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    name = parts[1]
                    lower = name.lower()
                    if "usb" in lower or "codec" in lower or "audio" in lower or "turntable" in lower:
                        return name
        except Exception:
            pass

    return target or ""

def check_owntone_playing():
    """Checks if OwnTone is actively playing audio to AirPlay/Chromecast outputs."""
    try:
        r = requests.get("http://127.0.0.1:3689/api/player", timeout=1)
        if r.status_code == 200:
            data = r.json()
            return data.get("state") == "play"
    except Exception:
        pass
    return False

def set_owntone_player(state="play"):
    """Starts or pauses OwnTone player."""
    try:
        requests.post(f"http://127.0.0.1:3689/api/player/{state}", timeout=2)
    except Exception:
        pass

def find_usb_alsa_device():
    """Finds USB audio capture device for ALSA fallback (e.g. plughw:1,0)."""
    try:
        res = subprocess.run(["arecord", "-l"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for line in res.stdout.splitlines():
            if line.startswith("card "):
                m = re.search(r"card\s+(\d+):.*device\s+(\d+):", line)
                if m:
                    card_num, dev_num = m.groups()
                    return f"plughw:{card_num},{dev_num}"
    except Exception:
        pass
    return "default"

def capture_sample(out_wav="/tmp/shazam_sample.wav", duration=10):
    """
    Captures a high-fidelity audio sample (default 10s) without interfering with the live OwnTone pipe.
    PipeWire allows multiple concurrent streams from the same audio source.
    """
    try:
        if os.path.exists(out_wav):
            os.remove(out_wav)
    except Exception:
        pass

    target = get_capture_target()

    # Determine PulseAudio source (safely ignoring raw ALSA hw: syntax for pulse)
    pulse_target = "default"
    if target and not target.startswith("hw:") and not target.startswith("plughw:") and target != "@DEFAULT_SOURCE@":
        pulse_target = target
    elif shutil.which("pactl"):
        try:
            res = subprocess.run(["pactl", "list", "sources", "short"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=1.0)
            for line in res.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 2:
                    s_name = parts[1]
                    lower = s_name.lower()
                    if not s_name.endswith(".monitor") and any(k in lower for k in ["usb", "codec", "audio", "turntable", "cx231xx"]):
                        pulse_target = s_name
                        break
        except Exception:
            pass

    # 1. ffmpeg via PulseAudio/PipeWire bridge (Non-blocking: allows concurrent playback & metering)
    if shutil.which("ffmpeg") and shutil.which("pactl"):
        try:
            cmd = [
                "ffmpeg", "-y", "-loglevel", "quiet",
                "-f", "pulse", "-i", pulse_target,
                "-t", str(duration), "-ar", "44100", "-ac", "2",
                out_wav
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 3)
            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 10000:
                return out_wav
        except Exception as e:
            print(f"[AnalogAir] ffmpeg pulse capture failed: {e}", flush=True)

    # 2. parec (Native PulseAudio tool, converted to wav)
    if shutil.which("parec") and shutil.which("ffmpeg"):
        try:
            p_cmd = ["parec", "--raw", "--format=s16le", "--rate=44100", "--channels=2"]
            if pulse_target and pulse_target != "default":
                p_cmd.extend(["-d", pulse_target])
            p_proc = subprocess.Popen(p_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            f_cmd = ["ffmpeg", "-y", "-loglevel", "quiet", "-f", "s16le", "-ar", "44100", "-ac", "2", "-i", "-", "-t", str(duration), out_wav]
            subprocess.run(f_cmd, stdin=p_proc.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 3)
            try:
                p_proc.terminate()
                p_proc.wait(timeout=0.1)
            except Exception:
                p_proc.kill()
            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 10000:
                return out_wav
        except Exception as e:
            print(f"[AnalogAir] parec capture failed: {e}", flush=True)

    # 3. sounddevice (In-process PortAudio)
    if sd:
        try:
            devices = sd.query_devices()
            input_dev = None
            for idx, dev in enumerate(devices):
                if dev.get("max_input_channels", 0) > 0:
                    name = dev.get("name", "").lower()
                    if any(k in name for k in ["cx231xx", "usb", "turntable", "codec", "audio"]):
                        input_dev = idx
                        break
            
            # Record directly from sound card
            recording = sd.rec(int(duration * 44100), samplerate=44100, channels=2, device=input_dev)
            sd.wait()
            int_data = (recording * 32767).astype(np.int16)
            with wave.open(out_wav, "wb") as wf:
                wf.setnchannels(2)
                wf.setsampwidth(2)
                wf.setframerate(44100)
                wf.writeframes(int_data.tobytes())
            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 10000:
                return out_wav
        except Exception as e:
            print(f"[AnalogAir] sounddevice capture failed: {e}", flush=True)

    # 4. arecord (Direct ALSA hardware capture)
    if shutil.which("arecord"):
        try:
            alsa_dev = target if (target and (target.startswith("hw:") or target.startswith("plughw:"))) else find_usb_alsa_device()
            cmd = ["arecord", "-q", "-D", alsa_dev, "-d", str(duration), "-f", "S16_LE", "-r", "44100", "-c", "2", out_wav]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 3)
            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 10000:
                return out_wav
        except Exception as e:
            print(f"[AnalogAir] arecord capture failed: {e}", flush=True)

    # 5. ffmpeg via general bridge
    if shutil.which("ffmpeg") and not os.path.exists(out_wav):
        try:
            cmd = [
                "ffmpeg", "-y", "-loglevel", "quiet",
                "-f", "pulse", "-i", "default",
                "-t", str(duration), "-ar", "44100", "-ac", "2",
                out_wav
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 3)
            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 10000:
                return out_wav
        except Exception as e:
            print(f"[AnalogAir] general ffmpeg pulse capture failed: {e}", flush=True)

    # 4. PipeWire pw-record / pw-cat
    for tool in ["pw-record", "pw-cat"]:
        tool_path = shutil.which(tool)
        if tool_path:
            try:
                cmd = [tool_path]
                if tool == "pw-cat":
                    cmd.append("--record")
                if target and target != "@DEFAULT_SOURCE@":
                    cmd.extend(["--target", target])
                cmd.extend(["--rate=44100", "--channels=2", "--format=s16", out_wav])
                proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(duration)
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()

                if os.path.exists(out_wav) and os.path.getsize(out_wav) > 10000:
                    return out_wav
            except Exception as e:
                print(f"[AnalogAir] PipeWire capture via {tool} failed: {e}", flush=True)

    return None

def compute_wav_rms(wav_path):
    if not wav_path or not os.path.exists(wav_path):
        return 0.0
    try:
        with wave.open(wav_path, "rb") as wf:
            n_frames = wf.getnframes()
            if n_frames == 0:
                return 0.0
            frames = wf.readframes(n_frames)
            data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
            if len(data) == 0:
                return 0.0
            return float(np.sqrt(np.mean(data**2)))
    except Exception as e:
        print(f"[AnalogAir] Error reading WAV RMS: {e}", flush=True)
        return 0.0

async def main():
    init_db()
    shazam = Shazam()
    is_playing = False
    session_locked = False
    current_track_id = None
    silence_counter = 0

    restore_default_artwork()
    idle_artist = get_setting("idle_artist", "Audio-Technica")
    idle_album = get_setting("idle_album", "AT-LP60X Turntable")
    idle_title = get_setting("idle_title", "AnalogAir Vinyl")

    write_to_pipe(make_xml(idle_title, idle_artist, idle_album))
    print("[AnalogAir] Daemon running with PipeWire audio monitoring.", flush=True)

    # Initial state
    try:
        with open(STATE_FILE, "w") as sf:
            json.dump({
                "status": "idle",
                "artist": idle_artist,
                "album": idle_album,
                "title": idle_title,
                "art_url": "/api/artwork/custom-standby.jpg",
                "rms": 0.0
            }, sf)
    except Exception:
        pass

    last_artist = idle_artist
    last_album = idle_album
    last_title = idle_title

    while True:
        enable_recognition = get_setting("enable_recognition", "false").lower() == "true"
        continuous_mode = get_setting("continuous_id", "false").lower() == "true"
        silence_timeout_sec = int(get_setting("silence_gap", "15"))
        silence_thresh = float(get_setting("silence_threshold", str(DEFAULT_SILENCE_THRESHOLD)))
        max_silence_counts = max(1, silence_timeout_sec // CHECK_INTERVAL)

        sample_duration = int(get_setting("sample_duration", "10"))
        sample_file = capture_sample(duration=sample_duration)
        rms = compute_wav_rms(sample_file)
        has_signal = (rms >= silence_thresh)

        print(f"[AnalogAir] Audio level: RMS={rms:.5f} (Threshold={silence_thresh:.5f}) | Has Signal={has_signal} | State Playing={is_playing} | Recognition={enable_recognition}", flush=True)

        if not has_signal:
            silence_counter += 1
            if is_playing and silence_counter >= max_silence_counts:
                print(f"[AnalogAir] Silence confirmed ({silence_timeout_sec}s). Needle lifted, restoring Standby.", flush=True)
                write_to_pipe(make_xml(idle_title, idle_artist, idle_album))
                restore_default_artwork()
                is_playing = False
                session_locked = False
                current_track_id = None
                resolved_art = None
                set_owntone_player("pause")
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "idle",
                            "artist": idle_artist,
                            "album": idle_album,
                            "title": idle_title,
                            "art_url": "",
                            "rms": float(rms),
                            "matched_via": "idle_default"
                        }, sf)
                except Exception:
                    pass
            elif is_playing:
                # Brief pause between tracks on vinyl side, keep playing state
                current_art = resolved_art if (resolved_art and resolved_art.startswith("http")) else f"/api/artwork/current.jpg?t={int(time.time())}"
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "playing",
                            "artist": last_artist,
                            "album": last_album,
                            "title": last_title,
                            "art_url": current_art,
                            "rms": float(rms),
                            "matched_via": "groove"
                        }, sf)
                except Exception:
                    pass
        else:
            silence_counter = 0
            if not is_playing:
                is_playing = True
                print(f"[AnalogAir] Needle drop detected! (RMS: {rms:.5f} >= {silence_thresh:.5f})", flush=True)
                set_owntone_player("play")

            # Check if Recognition is Disabled (No Recognition / Resource Saver Mode)
            if not enable_recognition:
                # Music streams with default art & labels; no Shazam lookup and no session recording
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "playing",
                            "artist": idle_artist,
                            "album": idle_album,
                            "title": idle_title,
                            "art_url": "",
                            "rms": float(rms),
                            "matched_via": "idle_default"
                        }, sf)
                except Exception:
                    pass
                await asyncio.sleep(CHECK_INTERVAL)
                continue

            if not continuous_mode and session_locked:
                # Still spinning the current identified record side
                current_art = resolved_art if (resolved_art and resolved_art.startswith("http")) else f"/api/artwork/current.jpg?t={int(time.time())}"
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "playing",
                            "artist": last_artist,
                            "album": last_album,
                            "title": last_title,
                            "art_url": current_art,
                            "rms": float(rms),
                            "matched_via": "shazam"
                        }, sf)
                except Exception:
                    pass
                await asyncio.sleep(CHECK_INTERVAL)
                continue

            # If not identified yet, write active playing state immediately so UI drops the needle!
            if current_track_id is None:
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "playing",
                            "artist": idle_artist,
                            "album": "Vinyl Playback",
                            "title": "Listening & Identifying...",
                            "art_url": f"/api/artwork/current.jpg?t={int(time.time())}",
                            "rms": float(rms),
                            "matched_via": "listening"
                        }, sf)
                except Exception:
                    pass

            if sample_file and os.path.exists(sample_file):
                print(f"[AnalogAir] Submitting {os.path.getsize(sample_file)} byte sample to Shazam for track identification...", flush=True)
                try:
                    out = await shazam.recognize(sample_file)
                    track = out.get("track", {})
                    if track:
                        track_id = track.get("key")
                        raw_title = track.get("title", idle_title)
                        raw_artist = track.get("subtitle", idle_artist)
                        print(f"[AnalogAir] Shazam match found: '{raw_title}' by '{raw_artist}' (ID: {track_id})", flush=True)
                        if track_id != current_track_id:
                            images = track.get("images", {})
                            shazam_art = (
                                images.get("coverarthq") or
                                images.get("coverart") or
                                track.get("share", {}).get("image") or
                                track.get("hub", {}).get("image") or
                                images.get("background")
                            )

                            raw_album = None
                            for s in track.get("sections", []):
                                for item in s.get("metadata", []):
                                    if item.get("title", "").strip().lower() == "album":
                                        raw_album = item.get("text", "").strip()
                                        break
                                if raw_album:
                                    break
                            if not raw_album:
                                raw_album = track.get("album") or idle_album
                            base_album = sanitize_album_title(raw_album)

                            track_key = f"{raw_artist} - {raw_title}"
                            override = get_override(track_key)
                            custom_art_url = None

                            if override:
                                artist = override[0] or raw_artist
                                album = sanitize_album_title(override[1])
                                custom_art_url = override[2]
                                mbid = override[3]
                                print(f"[AnalogAir] Applying saved local override: '{artist}' - '{album}'", flush=True)
                            else:
                                artist = raw_artist
                                canon_album, canon_art, canon_mbid = resolve_canonical_vinyl_album(artist, raw_title, candidate_album=base_album)
                                album = sanitize_album_title(canon_album or base_album)
                                custom_art_url = canon_art
                                mbid = canon_mbid
                                print(f"[AnalogAir] Resolved canonical vinyl album: '{artist}' - '{album}' (MBID: {mbid})", flush=True)

                            clean_title = sanitize_track_title(raw_title)
                            display_title = clean_title if continuous_mode else "AnalogAir"
                            last_artist = artist
                            last_album = album
                            last_title = display_title

                            resolved_art = update_artwork(artist, album, title=raw_title, mbid=mbid, custom_art_url=custom_art_url, fallback_art_url=shazam_art)
                            active_art_url = resolved_art if (resolved_art and resolved_art.startswith("http")) else f"/api/artwork/current.jpg?t={int(time.time())}"
                            write_to_pipe(make_xml(display_title, artist, album))
                            
                            current_track_id = track_id
                            if not continuous_mode and resolved_art:
                                session_locked = True
                                print(f"[AnalogAir] Album side locked with matched artwork: '{album}'. Artwork will remain active until needle lift.", flush=True)

                            try:
                                with open(STATE_FILE, "w") as sf:
                                    json.dump({
                                        "status": "playing",
                                        "artist": artist,
                                        "album": album,
                                        "title": display_title,
                                        "art_url": active_art_url,
                                        "rms": float(rms),
                                        "matched_via": "override" if override else "shazam"
                                    }, sf)
                            except Exception:
                                pass

                            # Log session in SQLite
                            try:
                                conn = sqlite3.connect(DB_PATH)
                                c = conn.cursor()
                                sess_id = f"{artist}_{album}"
                                c.execute("SELECT play_count FROM sessions WHERE id=?", (sess_id,))
                                srow = c.fetchone()
                                if srow:
                                    c.execute("UPDATE sessions SET play_count=play_count+1, played_at=CURRENT_TIMESTAMP WHERE id=?", (sess_id,))
                                else:
                                    c.execute("""
                                        INSERT INTO sessions (id, artist, album, first_track, art_url, mbid, has_override)
                                        VALUES (?, ?, ?, ?, ?, ?, ?)
                                    """, (sess_id, artist, album, raw_title, resolved_art, mbid, 1 if override else 0))
                                conn.commit()
                                conn.close()
                            except Exception as le:
                                print(f"[AnalogAir] Session logging error: {le}", flush=True)
                    else:
                        print(f"[AnalogAir] Shazam found no match for this sample, will retry on next check.", flush=True)
                except Exception as e:
                    print(f"[AnalogAir] Shazam error: {e}", flush=True)

        await asyncio.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    asyncio.run(main())
