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
import base64
import urllib.parse
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
DAEMON_SCRIPT_PATH = Path(__file__).resolve().parent / "analogair_daemon.py"
WEB_SCRIPT_PATH = Path(__file__).resolve()

OWNTONE_BASE = "http://127.0.0.1:3689"

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

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
    album = state.get("album", idle_album)
    title = state.get("title", idle_title)
    rms = state.get("rms", 0.0)
    matched_via = state.get("matched_via", "idle_default" if status == "idle" else "shazam")
    mbid = state.get("mbid")

    if not has_daemon_state:
        status = "idle"

    art_url = "/api/artwork/current.jpg"

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
            "continuousId": settings.get("continuous_id", "false").lower() == "true",
            "silenceGapSeconds": int(settings.get("silence_gap", 15)),
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
            subprocess.run(["systemctl", "--user", "restart", "analogair-capture.service"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if "selectedDeviceId" in data:
                subprocess.run(["systemctl", "--user", "restart", "analogair-daemon.service"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    # Update PipeWire filter-chain configuration if present
    pw_conf = HOME / ".config" / "pipewire" / "filter-chain.conf.d" / "analogair-tone.conf"
    if pw_conf.exists():
        try:
            content = f'''filter.chain = [
    {{
        name = "analogair-tone-dsp"
        type = "builtin"
        label = "biquad"
        control = {{
            "Gain" = {float(data.get("inputGainDb", 0))}
            "Bass" = {float(data.get("bassGainDb", 1.5))}
            "Mid" = {float(data.get("midGainDb", 0))}
            "Treble" = {float(data.get("trebleGainDb", 0.5))}
        }}
    }}
]
'''
            with open(pw_conf, "w") as f:
                f.write(content)
        except Exception:
            pass

    return web.json_response({"success": True, "tone": data})

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
                                return web.json_response({"output": res_data})
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
    q = (request.query.get("query") or "").strip()
    if not q:
        return web.json_response({"results": []})
    async with aiohttp.ClientSession() as session:
        try:
            url = f"https://itunes.apple.com/search?term={urllib.parse.quote(q)}&entity=album&limit=10"
            async with session.get(url, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    results = []
                    for item in data.get("results", []):
                        art100 = item.get("artworkUrl100", "")
                        art1400 = art100.replace("100x100bb", "1400x1400bb") if art100 else ""
                        results.append({
                            "album": item.get("collectionName", ""),
                            "artist": item.get("artistName", ""),
                            "releaseDate": item.get("releaseDate", "")[:4] if item.get("releaseDate") else "",
                            "trackCount": item.get("trackCount", 0),
                            "artworkUrl": art1400
                        })
                    return web.json_response({"results": results})
        except Exception as e:
            print(f"[AnalogAir Web] iTunes search error: {e}", flush=True)
    return web.json_response({"results": []})

async def search_musicbrainz(request):
    query = (request.query.get("query") or "").strip()
    artist = (request.query.get("artist") or "").strip()
    recording = (request.query.get("recording") or "").strip()

    if not query and not (artist or recording):
        return web.json_response({"candidates": []})

    async def fetch_itunes_fallback():
        try:
            search_term = query if query else f"{artist} {recording}".strip()
            async with aiohttp.ClientSession() as session:
                url = f"https://itunes.apple.com/search?term={urllib.parse.quote(search_term)}&entity=album&limit=10"
                async with session.get(url, timeout=5) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        candidates = []
                        for item in data.get("results", []):
                            art100 = item.get("artworkUrl100", "")
                            candidates.append({
                                "id": f"itunes-{item.get('collectionId')}",
                                "title": item.get("collectionName", ""),
                                "artist": item.get("artistName", ""),
                                "year": item.get("releaseDate", "")[:4] if item.get("releaseDate") else "Release",
                                "format": '12" Vinyl',
                                "isFullAlbum": True,
                                "isCompilation": False,
                                "typeLabel": "Studio Album (Canonical)",
                                "artUrl": art100.replace("100x100bb", "1400x1400bb") if art100 else ""
                            })
                        return candidates
        except Exception:
            pass
        return []

    try:
        mb_query = urllib.parse.quote(query) if query else urllib.parse.quote(f'artist:"{artist}" AND recording:"{recording}"')
        url = f"https://musicbrainz.org/ws/2/recording?query={mb_query}&inc=release-groups+releases&fmt=json"
        headers = {
            "User-Agent": "AnalogAir/1.0 (https://github.com/analogair/analogair-streamer; contact: stream@analogair.local)"
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=6) as resp:
                if resp.status != 200:
                    fb = await fetch_itunes_fallback()
                    return web.json_response({"candidates": fb})

                data = await resp.json()
                candidate_map = {}
                for rec in data.get("recordings", []):
                    rec_artist = (rec.get("artist-credit") or [{}])[0].get("name") or artist or "Unknown Artist"
                    for rel in rec.get("releases", []):
                        if rel.get("status") and rel.get("status") != "Official":
                            continue
                        rg = rel.get("release-group") or {}
                        rg_id = rg.get("id") or rel.get("id")
                        title = rg.get("title") or rel.get("title")
                        rel_date = rg.get("first-release-date") or rel.get("date") or "N/A"
                        year = rel_date[:4] if rel_date else "N/A"
                        primary_type = rg.get("primary-type") or "Album"
                        secondary_types = rg.get("secondary-types") or []
                        if "Live" in secondary_types or "Bootleg" in secondary_types:
                            continue
                        if rg_id in candidate_map:
                            continue
                        is_full_album = (primary_type == "Album" and len(secondary_types) == 0)
                        is_compilation = (primary_type == "Compilation" or "Compilation" in secondary_types)
                        type_label = "Studio Album (Canonical)" if is_full_album else ("Compilation" if is_compilation else primary_type)
                        media_list = rel.get("media") or [{}]
                        fmt = media_list[0].get("format") if media_list else '12" Vinyl'
                        candidate_map[rg_id] = {
                            "id": rel.get("id"),
                            "title": title,
                            "artist": rec_artist,
                            "year": year,
                            "format": fmt or '12" Vinyl',
                            "isFullAlbum": is_full_album,
                            "isCompilation": is_compilation,
                            "typeLabel": type_label,
                            "artUrl": f"https://coverartarchive.org/release/{rel.get('id')}/front-500"
                        }

                candidates = list(candidate_map.values())
                candidates.sort(key=lambda c: (not c["isFullAlbum"], c["year"] or "9999"))
                candidates = candidates[:15]
                if not candidates:
                    candidates = await fetch_itunes_fallback()
                return web.json_response({"candidates": candidates})
    except Exception:
        fb = await fetch_itunes_fallback()
        return web.json_response({"candidates": fb})

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

    with get_db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO release_overrides 
            (track_key, custom_artist, custom_album, custom_art_url, release_mbid, format, year, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (track_key, custom_artist, custom_album, custom_art_url, release_mbid, fmt, year))

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
            "continuousId": settings.get("continuous_id", "false").lower() == "true",
            "silenceGapSeconds": int(settings.get("silence_gap", 15)),
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
            "continuousId": "continuous_id",
            "silenceGapSeconds": "silence_gap",
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

# --- 8. Artwork Serving & Upload ---
async def serve_current_art(request):
    if LIVE_ART_PATH.exists() and LIVE_ART_PATH.stat().st_size > 500:
        return web.FileResponse(LIVE_ART_PATH)
    if DEFAULT_ART_PATH.exists() and DEFAULT_ART_PATH.stat().st_size > 500:
        return web.FileResponse(DEFAULT_ART_PATH)
    if FALLBACK_ART_PATH.exists():
        return web.FileResponse(FALLBACK_ART_PATH)
    if FALLBACK_SRC_ART.exists():
        return web.FileResponse(FALLBACK_SRC_ART)
    return web.Response(status=404)

async def serve_standby_art(request):
    if DEFAULT_ART_PATH.exists() and DEFAULT_ART_PATH.stat().st_size > 500:
        return web.FileResponse(DEFAULT_ART_PATH)
    if FALLBACK_ART_PATH.exists():
        return web.FileResponse(FALLBACK_ART_PATH)
    if FALLBACK_SRC_ART.exists():
        return web.FileResponse(FALLBACK_SRC_ART)
    return web.Response(status=404)

async def serve_live_pipe_art(request):
    if LIVE_ART_PATH.exists():
        return web.FileResponse(LIVE_ART_PATH)
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

# --- 9. Needle Drop & Silence Simulation Triggers ---
SIMULATION_PRESETS = [
    {
        "artist": "Pink Floyd",
        "album": "The Dark Side of the Moon",
        "title": "Breathe (In the Air)",
        "artUrl": "https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=1000&q=80",
        "mbid": "a30f30c6-3023-3f18-be48-6a3f1246d7e0",
        "matchedVia": "local_override"
    },
    {
        "artist": "Miles Davis",
        "album": "Kind of Blue (180g Vinyl Edition)",
        "title": "Freddie Freeloader",
        "artUrl": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1000&q=80",
        "mbid": "4979e27c-fb8d-3687-b99b-4392949ff736",
        "matchedVia": "musicbrainz"
    },
    {
        "artist": "Daft Punk",
        "album": "Random Access Memories",
        "title": "Give Life Back to Music",
        "artUrl": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1000&q=80",
        "mbid": "018f60ff-3d02-4ec4-9d62-ce46c4f3ca4e",
        "matchedVia": "shazam"
    }
]

_sim_index = 0

async def simulate_needle_drop(request):
    global _sim_index
    preset = SIMULATION_PRESETS[_sim_index % len(SIMULATION_PRESETS)]
    _sim_index += 1

    now_iso = datetime.now().isoformat()
    state = {
        "status": "playing",
        "artist": preset["artist"],
        "album": preset["album"],
        "title": preset["title"],
        "artUrl": preset["artUrl"],
        "mbid": preset["mbid"],
        "sourceType": "vinyl",
        "isContinuous": True,
        "sideLocked": True,
        "playCount": 1,
        "rms": 0.22,
        "sampleRate": 44100,
        "bitDepth": 16,
        "matched_via": preset["matchedVia"],
        "startedAt": now_iso
    }
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception:
        pass

    sess_id = f"sess-{int(time.time()*1000)}"
    with get_db() as conn:
        existing = conn.execute("SELECT id, play_count FROM sessions WHERE artist=? AND album=?", (preset["artist"], preset["album"])).fetchone()
        if existing:
            conn.execute("UPDATE sessions SET play_count = play_count + 1, played_at = CURRENT_TIMESTAMP WHERE id=?", (existing["id"],))
        else:
            conn.execute("""
                INSERT INTO sessions (id, artist, album, first_track, art_url, played_at, play_count, mbid, has_override)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1, ?, 0)
            """, (sess_id, preset["artist"], preset["album"], preset["title"], preset["artUrl"], preset["mbid"]))
        conn.commit()

    if preset["artUrl"].startswith("http"):
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(preset["artUrl"], timeout=4) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        with open(LIVE_ART_PATH, "wb") as f:
                            f.write(content)
            except Exception:
                pass

    write_to_metadata_pipe(preset["title"], preset["artist"], preset["album"])

    return web.json_response({
        "success": True,
        "state": {
            "status": "playing",
            "artist": preset["artist"],
            "album": preset["album"],
            "title": preset["title"],
            "artUrl": "/api/artwork/current.jpg",
            "mbid": preset["mbid"],
            "sourceType": "vinyl",
            "isContinuous": True,
            "sideLocked": True,
            "playCount": 1,
            "rmsLevel": 0.22,
            "sampleRate": 44100,
            "bitDepth": 16,
            "inputDeviceName": "AnalogAir Vinyl (PipeWire Capture)",
            "matchedVia": preset["matchedVia"],
            "startedAt": now_iso
        }
    })

async def simulate_silence(request):
    settings = {}
    with get_db() as conn:
        for row in conn.execute("SELECT key, value FROM settings"):
            settings[row["key"]] = row["value"]

    idle_artist = settings.get("idle_artist", "Audio-Technica")
    idle_album = settings.get("idle_album", "AT-LP60X Turntable")
    idle_title = settings.get("idle_title", "AnalogAir Vinyl")

    now_iso = datetime.now().isoformat()
    state = {
        "status": "idle",
        "artist": idle_artist,
        "album": idle_album,
        "title": idle_title,
        "artUrl": "/api/artwork/custom-standby.jpg",
        "sourceType": settings.get("source_type", "vinyl"),
        "isContinuous": False,
        "sideLocked": False,
        "rms": 0.001,
        "sampleRate": 44100,
        "bitDepth": 16,
        "matched_via": "idle_default",
        "startedAt": now_iso
    }
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f)
    except Exception:
        pass

    if DEFAULT_ART_PATH.exists():
        try:
            shutil.copyfile(DEFAULT_ART_PATH, LIVE_ART_PATH)
        except Exception:
            pass

    write_to_metadata_pipe(idle_title, idle_artist, idle_album)

    return web.json_response({
        "success": True,
        "state": {
            "status": "idle",
            "artist": idle_artist,
            "album": idle_album,
            "title": idle_title,
            "artUrl": "/api/artwork/custom-standby.jpg",
            "sourceType": settings.get("source_type", "vinyl"),
            "isContinuous": False,
            "sideLocked": False,
            "playCount": 0,
            "rmsLevel": 0.001,
            "sampleRate": 44100,
            "bitDepth": 16,
            "inputDeviceName": "AnalogAir Vinyl (PipeWire Capture)",
            "matchedVia": "idle_default",
            "startedAt": now_iso
        }
    })

# --- 10. Installer & Downloadable Artifacts ---
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
                            break
            except Exception as e:
                print(f"[AnalogAir Web] Speaker auto-connect check: {e}", flush=True)

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

    # 3. OwnTone Multi-Room AirPlay Outputs
    app.router.add_get('/api/owntone/outputs', get_owntone_outputs)
    app.router.add_post('/api/owntone/outputs/{id}/toggle', toggle_owntone_output)
    app.router.add_post('/api/owntone/outputs/{id}/volume', set_owntone_output_volume)
    app.router.add_post('/api/owntone/outputs/{id}/favorite', toggle_favorite_output)

    # 4. Search & Overrides
    app.router.add_get('/api/search/musicbrainz', search_musicbrainz)
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

    # 7. Artwork Serving & Uploads
    app.router.add_get('/api/artwork/current.jpg', serve_current_art)
    app.router.add_get('/api/artwork/custom-standby.jpg', serve_standby_art)
    app.router.add_get('/api/artwork/AnalogAir.jpg', serve_live_pipe_art)
    app.router.add_post('/api/upload/default-art', upload_default_art)

    # 8. Testing / Simulation Triggers
    app.router.add_post('/api/simulate/needle-drop', simulate_needle_drop)
    app.router.add_post('/api/simulate/silence', simulate_silence)

    # 9. Downloadable Install Artifacts
    app.router.add_get('/api/installer/desktop-shortcut', download_desktop_shortcut)
    app.router.add_get('/api/installer/script', download_install_script)
    app.router.add_get('/api/installer/daemon', download_daemon_script)
    app.router.add_get('/api/installer/web', download_web_script)

    # 10. Static assets
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
