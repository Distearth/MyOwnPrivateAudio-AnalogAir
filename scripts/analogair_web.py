#!/usr/bin/env python3
"""
AnalogAir Local Web UI & API Server
Serves the AnalogAir Touchscreen / Mobile interface on port 3000
Proxies OwnTone outputs (AirPlay speakers), tone DSP controls, and SQLite settings
"""
import os
import json
import sqlite3
import subprocess
import shutil
from pathlib import Path
from aiohttp import web
import aiohttp

HOME = Path.home()
CONFIG_DIR = HOME / ".config" / "analogair"
UI_DIR = CONFIG_DIR / "ui"
DB_PATH = CONFIG_DIR / "settings.db"
STATE_FILE = Path("/tmp/analogair_state.json")
PIPE_DIR = HOME / "Music" / "AnalogAir"
DEFAULT_ART_PATH = PIPE_DIR / "AnalogAir_default.jpg"
LIVE_ART_PATH = PIPE_DIR / "AnalogAir.jpg"

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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
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
            "input_gain_db": "0.0",
            "bass_gain_db": "1.5",
            "mid_gain_db": "0.0",
            "treble_gain_db": "0.5"
        }
        for k, v in defaults.items():
            c.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (k, v))
        conn.commit()

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

    # Current playing info
    has_daemon_state = bool(state)
    status = state.get("status", "idle")
    artist = state.get("artist", idle_artist)
    album = state.get("album", idle_album)
    title = state.get("title", idle_title)
    rms = state.get("rms", 0.0)
    matched_via = state.get("matched_via", "idle_default" if status == "idle" else "shazam")

    # Only query OwnTone if daemon state is completely absent (daemon not yet started)
    if not has_daemon_state:
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{OWNTONE_BASE}/api/player", timeout=1) as resp:
                    if resp.status == 200:
                        pdata = await resp.json()
                        if pdata.get("state") == "play":
                            status = "playing"
                            if title == idle_title:
                                title = "Vinyl Playback"
                            if matched_via == "idle_default":
                                matched_via = "listening"
            except Exception:
                pass

    # Determine artwork URL
    art_url = "/api/artwork/current.jpg"

    return web.json_response({
        "status": status,
        "artist": artist,
        "album": album,
        "title": title,
        "artUrl": art_url,
        "rmsLevel": rms,
        "sampleRate": 44100,
        "bitDepth": 16,
        "sourceType": settings.get("source_type", "vinyl"),
        "isContinuous": settings.get("continuous_id", "false").lower() == "true",
        "sideLocked": True,
        "inputDeviceName": "AnalogAir Vinyl (PipeWire Capture)",
        "matchedVia": matched_via,
        "tone": {
            "inputGainDb": float(settings.get("input_gain_db", 0)),
            "bassGainDb": float(settings.get("bass_gain_db", 1.5)),
            "midGainDb": float(settings.get("mid_gain_db", 0)),
            "trebleGainDb": float(settings.get("treble_gain_db", 0.5)),
            "selectedDeviceId": settings.get("audio_device", "default")
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
            "dimMinutes": 25,
            "idleFadeSeconds": 10,
            "owntoneHost": "localhost",
            "owntonePort": 3689,
            "enableToneDsp": True
        }
    })

async def get_tone(request):
    settings = {}
    with get_db() as conn:
        for row in conn.execute("SELECT key, value FROM settings"):
            settings[row["key"]] = row["value"]

    # Detect devices via arecord
    devices = []
    try:
        res = subprocess.run(["arecord", "-l"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for line in res.stdout.splitlines():
            if line.startswith("card "):
                m = re.match(r"card\s+(\d+):\s+([^,]+),\s+device\s+(\d+):\s+(.*)", line)
                if m:
                    card_num, card_name, dev_num, dev_desc = m.groups()
                    devices.append({
                        "id": f"hw:{card_num},{dev_num}",
                        "name": f"{card_name.strip()} ({dev_desc.strip()})",
                        "cardIndex": int(card_num),
                        "supportedRates": [44100, 48000],
                        "isDefault": (len(devices) == 0),
                        "channels": 2
                    })
                else:
                    devices.append({
                        "id": line.strip(),
                        "name": line.strip(),
                        "cardIndex": 0,
                        "supportedRates": [44100],
                        "isDefault": (len(devices) == 0),
                        "channels": 2
                    })
    except Exception:
        pass

    if not devices:
        devices = [{
            "id": "@DEFAULT_SOURCE@",
            "name": "PipeWire Auto-Select / Default Source",
            "cardIndex": 0,
            "supportedRates": [44100, 48000],
            "isDefault": True,
            "channels": 2
        }]

    return web.json_response({
        "inputGainDb": float(settings.get("input_gain_db", 0)),
        "bassGainDb": float(settings.get("bass_gain_db", 1.5)),
        "midGainDb": float(settings.get("mid_gain_db", 0)),
        "trebleGainDb": float(settings.get("treble_gain_db", 0.5)),
        "selectedDeviceId": settings.get("audio_device", devices[0]["id"] if devices else "default"),
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
        conn.commit()

    # Update PipeWire filter-chain configuration if supported
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
    all_favs = []
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

async def get_sessions(request):
    sessions = []
    with get_db() as conn:
        for row in conn.execute("SELECT id, artist, album, first_track, art_url, played_at, play_count, mbid, has_override FROM sessions ORDER BY played_at DESC LIMIT 20"):
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

async def save_settings(request):
    data = await request.json()
    with get_db() as conn:
        mapping = {
            "sourceType": "source_type",
            "idleArtist": "idle_artist",
            "idleAlbum": "idle_album",
            "idleTitle": "idle_title",
            "continuousId": "continuous_id",
            "silenceGapSeconds": "silence_gap"
        }
        for client_k, db_k in mapping.items():
            if client_k in data:
                conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (db_k, str(data[client_k])))
        conn.commit()
    return web.json_response({"success": True, "settings": data})

async def serve_current_art(request):
    if LIVE_ART_PATH.exists():
        return web.FileResponse(LIVE_ART_PATH)
    if DEFAULT_ART_PATH.exists():
        return web.FileResponse(DEFAULT_ART_PATH)
    return web.Response(status=404)

async def serve_standby_art(request):
    if DEFAULT_ART_PATH.exists():
        return web.FileResponse(DEFAULT_ART_PATH)
    return web.Response(status=404)

async def upload_default_art(request):
    reader = await request.multipart()
    field = await reader.next()
    if field and field.name == 'file':
        PIPE_DIR.mkdir(parents=True, exist_ok=True)
        with open(DEFAULT_ART_PATH, 'wb') as f:
            while True:
                chunk = await field.read_chunk()
                if not chunk:
                    break
                f.write(chunk)
        shutil.copyfile(DEFAULT_ART_PATH, LIVE_ART_PATH)
        return web.json_response({"success": True, "url": "/api/artwork/custom-standby.jpg"})
    return web.json_response({"error": "No file uploaded"}, status=400)

async def search_itunes(request):
    q = request.query.get("query", "")
    if not q:
        return web.json_response({"results": []})
    async with aiohttp.ClientSession() as session:
        try:
            url = f"https://itunes.apple.com/search?term={q}&entity=album&limit=10"
            async with session.get(url, timeout=5) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return web.json_response(data)
        except Exception:
            pass
    return web.json_response({"results": []})

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

def main():
    init_db()
    app = web.Application()

    # API Routes
    app.router.add_get('/api/state', get_state)
    app.router.add_get('/api/tone', get_tone)
    app.router.add_post('/api/tone', save_tone)
    app.router.add_get('/api/owntone/outputs', get_owntone_outputs)
    app.router.add_post('/api/owntone/outputs/{id}/toggle', toggle_owntone_output)
    app.router.add_post('/api/owntone/outputs/{id}/volume', set_owntone_output_volume)
    app.router.add_post('/api/owntone/outputs/{id}/favorite', toggle_favorite_output)
    app.router.add_get('/api/sessions', get_sessions)
    app.router.add_post('/api/settings', save_settings)
    app.router.add_get('/api/artwork/current.jpg', serve_current_art)
    app.router.add_get('/api/artwork/custom-standby.jpg', serve_standby_art)
    app.router.add_post('/api/upload/default-art', upload_default_art)
    app.router.add_get('/api/search/itunes', search_itunes)

    # Static assets
    assets_dir = UI_DIR / "assets"
    if assets_dir.exists():
        app.router.add_static('/assets', str(assets_dir))

    # SPA Entry Point & Catch-All
    app.router.add_get('/', serve_index)
    app.router.add_get('/{tail:.*}', serve_static_or_spa)

    print("AnalogAir Web Server running on http://0.0.0.0:3000", flush=True)
    web.run_app(app, host='0.0.0.0', port=3000)

if __name__ == '__main__':
    main()
