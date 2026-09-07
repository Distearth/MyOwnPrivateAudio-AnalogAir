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
import wave
import numpy as np
import requests
try:
    import sounddevice as sd
except Exception:
    sd = None
from shazamio import Shazam
import sys
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

def restore_default_artwork():
    try:
        r = requests.get("http://127.0.0.1:3000/api/artwork/custom-standby.jpg", timeout=2)
        if r.status_code == 200 and len(r.content) > 500:
            with open(DEFAULT_ART_PATH, "wb") as f:
                f.write(r.content)
    except:
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

def update_artwork(artist, album, mbid=None, custom_art_url=None):
    art_url = custom_art_url
    if not art_url:
        try:
            query = f"{artist} {album}"
            url = f"https://itunes.apple.com/search?term={requests.utils.quote(query)}&entity=album&limit=1"
            res = requests.get(url, timeout=4).json()
            if res.get("results"):
                art_url = res["results"][0].get("artworkUrl100", "").replace("100x100bb", "1400x1400bb")
        except:
            pass
    if not art_url and mbid:
        try:
            caa_url = f"https://coverartarchive.org/release/{mbid}/front-500"
            res = requests.get(caa_url, timeout=4)
            if res.status_code == 200:
                art_url = caa_url
        except:
            pass
    if art_url:
        try:
            img_bytes = requests.get(art_url, timeout=5).content
            image = Image.open(io.BytesIO(img_bytes))
            if image.mode in ("RGBA", "P", "LA"):
                image = image.convert("RGB")
            image.save(LIVE_ART_PATH, "JPEG", quality=92)
            return art_url
        except:
            pass
    restore_default_artwork()
    return None

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

def capture_sample(out_wav="/tmp/shazam_sample.wav", duration=6):
    """
    Captures a 6-second audio sample without interfering with the live OwnTone pipe.
    PipeWire allows multiple concurrent streams from the same audio source.
    """
    try:
        if os.path.exists(out_wav):
            os.remove(out_wav)
    except Exception:
        pass

    target = get_capture_target()

    # 1. PipeWire pw-record / pw-cat (glitch-free native PipeWire client)
    for tool in ["pw-record", "pw-cat"]:
        tool_path = shutil.which(tool)
        if tool_path:
            cmd = [tool_path]
            if tool == "pw-cat":
                cmd.append("--record")
            if target and target != "@DEFAULT_SOURCE@":
                cmd.extend(["--target", target])
            cmd.extend(["-d", f"{duration}s", "--rate=44100", "--channels=2", "--format=s16", out_wav])
            try:
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 4)
                if os.path.exists(out_wav) and os.path.getsize(out_wav) > 4000:
                    return out_wav
            except Exception:
                # Fallback if -d duration syntax is not supported in this pw-record version
                try:
                    fallback_cmd = [tool_path]
                    if tool == "pw-cat":
                        fallback_cmd.append("--record")
                    if target and target != "@DEFAULT_SOURCE@":
                        fallback_cmd.extend(["--target", target])
                    fallback_cmd.extend(["--rate=44100", "--channels=2", "--format=s16", out_wav])
                    proc = subprocess.Popen(fallback_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    time.sleep(duration)
                    proc.send_signal(signal.SIGINT)
                    try:
                        proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()

                    if os.path.exists(out_wav) and os.path.getsize(out_wav) > 4000:
                        return out_wav
                except Exception as e:
                    print(f"[AnalogAir] PipeWire capture via {tool} failed: {e}", flush=True)

    # 2. ffmpeg via PulseAudio/PipeWire bridge
    if shutil.which("ffmpeg"):
        try:
            pulse_target = target if target and target != "@DEFAULT_SOURCE@" else "default"
            cmd = [
                "ffmpeg", "-y", "-loglevel", "quiet",
                "-f", "pulse", "-i", pulse_target,
                "-t", str(duration), "-ar", "44100", "-ac", "2",
                out_wav
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 3)
            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 4000:
                return out_wav
        except Exception as e:
            print(f"[AnalogAir] ffmpeg pulse capture failed: {e}", flush=True)

    # 3. arecord (ALSA)
    if shutil.which("arecord"):
        try:
            alsa_dev = target if (target and (target.startswith("hw:") or target.startswith("plughw:"))) else "default"
            cmd = ["arecord", "-q", "-D", alsa_dev, "-d", str(duration), "-f", "S16_LE", "-r", "44100", "-c", "2", out_wav]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=duration + 3)
            if os.path.exists(out_wav) and os.path.getsize(out_wav) > 4000:
                return out_wav
        except Exception as e:
            print(f"[AnalogAir] arecord capture failed: {e}", flush=True)

    # 4. sounddevice fallback
    if sd:
        try:
            devices = sd.query_devices()
            input_dev = None
            for idx, dev in enumerate(devices):
                if dev.get("max_input_channels", 0) > 0:
                    name = dev.get("name", "").lower()
                    if "usb" in name or "audio" in name or "turntable" in name or "codec" in name:
                        input_dev = idx
                        break
                    if input_dev is None:
                        input_dev = idx

            recording = sd.rec(int(duration * 44100), samplerate=44100, channels=2, device=input_dev)
            sd.wait()
            int_data = (recording * 32767).astype(np.int16)
            with wave.open(out_wav, "wb") as wf:
                wf.setnchannels(2)
                wf.setsampwidth(2)
                wf.setframerate(44100)
                wf.writeframes(int_data.tobytes())
            return out_wav
        except Exception as e:
            print(f"[AnalogAir] sounddevice capture failed: {e}", flush=True)

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
        continuous_mode = get_setting("continuous_id", "false").lower() == "true"
        silence_timeout_sec = int(get_setting("silence_gap", "15"))
        silence_thresh = float(get_setting("silence_threshold", str(DEFAULT_SILENCE_THRESHOLD)))
        max_silence_counts = max(1, silence_timeout_sec // CHECK_INTERVAL)

        sample_file = capture_sample(duration=6)
        rms = compute_wav_rms(sample_file)
        owntone_playing = check_owntone_playing()
        has_signal = (rms >= silence_thresh) or owntone_playing

        print(f"[AnalogAir] Audio level: RMS={rms:.5f} (Threshold={silence_thresh:.5f}) | OwnTone Playing={owntone_playing} | Has Signal={has_signal} | State Playing={is_playing}", flush=True)

        if not has_signal:
            silence_counter += 1
            if is_playing and silence_counter >= max_silence_counts:
                print(f"[AnalogAir] Silence confirmed ({silence_timeout_sec}s). Needle lifted, restoring Standby.", flush=True)
                write_to_pipe(make_xml(idle_title, idle_artist, idle_album))
                restore_default_artwork()
                is_playing = False
                session_locked = False
                current_track_id = None
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "idle",
                            "artist": idle_artist,
                            "album": idle_album,
                            "title": idle_title,
                            "art_url": "/api/artwork/custom-standby.jpg",
                            "rms": float(rms),
                            "matched_via": "idle_default"
                        }, sf)
                except Exception:
                    pass
            elif is_playing:
                # Brief pause between tracks on vinyl side, keep playing state
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "playing",
                            "artist": last_artist,
                            "album": last_album,
                            "title": last_title,
                            "art_url": "/api/artwork/current.jpg",
                            "rms": float(rms),
                            "matched_via": "groove"
                        }, sf)
                except Exception:
                    pass
        else:
            silence_counter = 0
            if not is_playing:
                is_playing = True
                print(f"[AnalogAir] Needle drop detected! (RMS: {rms:.5f})", flush=True)

            if not continuous_mode and session_locked:
                # Still spinning the current identified record side
                try:
                    with open(STATE_FILE, "w") as sf:
                        json.dump({
                            "status": "playing",
                            "artist": last_artist,
                            "album": last_album,
                            "title": last_title,
                            "art_url": "/api/artwork/current.jpg",
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
                            "art_url": "/api/artwork/current.jpg",
                            "rms": float(rms),
                            "matched_via": "listening"
                        }, sf)
                except Exception:
                    pass

            if sample_file and os.path.exists(sample_file):
                try:
                    out = await shazam.recognize(sample_file)
                    track = out.get("track", {})
                    if track:
                        track_id = track.get("key")
                        if track_id != current_track_id:
                            raw_title = track.get("title", idle_title)
                            raw_artist = track.get("subtitle", idle_artist)
                            sections = track.get("sections", [{}])
                            metadata = sections[0].get("metadata", [{}]) if sections else [{}]
                            base_album = metadata[0].get("text", idle_album) if metadata else idle_album

                            track_key = f"{raw_artist} - {raw_title}"
                            override = get_override(track_key)
                            custom_art_url = None

                            if override:
                                artist = override[0] or raw_artist
                                album = override[1]
                                custom_art_url = override[2]
                                mbid = override[3]
                            else:
                                artist = raw_artist
                                album = base_album
                                mbid = None

                            display_title = raw_title if continuous_mode else "AnalogAir"
                            last_artist = artist
                            last_album = album
                            last_title = display_title

                            resolved_art = update_artwork(artist, album, mbid, custom_art_url)
                            write_to_pipe(make_xml(display_title, artist, album))
                            
                            current_track_id = track_id
                            if not continuous_mode:
                                session_locked = True

                            try:
                                with open(STATE_FILE, "w") as sf:
                                    json.dump({
                                        "status": "playing",
                                        "artist": artist,
                                        "album": album,
                                        "title": display_title,
                                        "art_url": "/api/artwork/current.jpg",
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
                except Exception as e:
                    print(f"[AnalogAir] Shazam error: {e}", flush=True)

        await asyncio.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    asyncio.run(main())
