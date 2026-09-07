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

    # If daemon is not running or has not detected signal, stay strictly idle
    if not has_daemon_state:
        status = "idle"

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

    # Detect devices via pactl sources first (for PipeWire/Pulse friendly names), and arecord -l as fallback
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
                    # Avoid duplicate default
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

    # Apply Input Preamp Gain directly to the selected or default PipeWire / PulseAudio source
    if "inputGainDb" in data:
        try:
            gain_db = float(data["inputGainDb"])
            # 0 dB = 100%, +6 dB ≈ 200%, -6 dB ≈ 50%, +12 dB ≈ 400%
            vol_pct = max(0, min(400, int(round(100.0 * (10.0 ** (gain_db / 20.0))))))
            
            # 1. Set default source volume
            subprocess.run(["pactl", "set-source-volume", "@DEFAULT_SOURCE@", f"{vol_pct}%"], 
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            # 2. If a specific device is selected, set its volume directly
            if selected_dev and selected_dev not in ["@DEFAULT_SOURCE@", "default"]:
                subprocess.run(["pactl", "set-source-volume", selected_dev, f"{vol_pct}%"], 
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            # 3. If it's an ALSA hw device (hw:X,Y), set ALSA mixer volume on card X
            if selected_dev and selected_dev.startswith("hw:"):
                try:
                    card_idx = selected_dev.split(":")[1].split(",")[0]
                    for ctrl in ["Capture", "Line", "Mic"]:
                        subprocess.run(["amixer", "-c", card_idx, "sset", ctrl, f"{vol_pct}%"], 
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                except Exception:
                    pass
            else:
                # Also apply to all detected capture cards in ALSA as general protection
                for card in ["0", "1", "2", "3"]:
                    for ctrl in ["Capture", "Line", "Mic"]:
                        subprocess.run(["amixer", "-c", card, "sset", ctrl, f"{vol_pct}%"], 
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    # If tone equalizer OR selected device changed, reload live capture stream to apply immediately
    if any(k in data for k in ["bassGainDb", "midGainDb", "trebleGainDb", "selectedDeviceId"]):
        try:
            subprocess.run(["systemctl", "--user", "restart", "analogair-capture.service"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # Also restart daemon so it monitors the newly chosen soundcard
            if "selectedDeviceId" in data:
                subprocess.run(["systemctl", "--user", "restart", "analogair-daemon.service"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

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

async def auto_connect_startup_speakers(app):
    # Wait 3 seconds after boot for OwnTone to discover local/AirPlay network devices
    await asyncio.sleep(3)
    fav_ids = set()
    with get_db() as conn:
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS favorite_speakers (speaker_id TEXT PRIMARY KEY)")
            for row in conn.execute("SELECT speaker_id FROM favorite_speakers"):
                fav_ids.add(str(row["speaker_id"]))
        except Exception:
            pass

    if fav_ids:
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{OWNTONE_BASE}/api/outputs", timeout=3) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for o in data.get("outputs", []):
                            oid = str(o.get("id"))
                            if oid in fav_ids and not o.get("selected", False):
                                await session.put(f"{OWNTONE_BASE}/api/outputs/{oid}", json={"selected": True, "volume": 100}, timeout=2)
                                print(f"[AnalogAir Web] Auto-connected startup speaker: {o.get('name')}", flush=True)
            except Exception as e:
                print(f"[AnalogAir Web] Speaker auto-connect check: {e}", flush=True)

async def start_background_tasks(app):
    asyncio.create_task(auto_connect_startup_speakers(app))

def main():
    init_db()
    app = web.Application()
    app.on_startup.append(start_background_tasks)

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
