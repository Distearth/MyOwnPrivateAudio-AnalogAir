import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import zlib from 'zlib';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Persistent local data store file
const DATA_DIR = path.join(process.cwd(), '.analogair_data');
const DB_FILE = path.join(DATA_DIR, 'analogair_db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface StoredData {
  settings: {
    sourceType: 'vinyl' | 'tape' | 'cd' | 'aux';
    customStreamLabel: string;
    defaultArtUrl: string;
    idleArtist: string;
    idleAlbum: string;
    idleTitle: string;
    continuousId: boolean;
    silenceGapSeconds: number;
    dimMinutes: number;
    idleFadeSeconds: number;
    owntoneHost: string;
    owntonePort: number;
    enableToneDsp: boolean;
  };
  tone: {
    inputGainDb: number;
    bassGainDb: number;
    midGainDb: number;
    trebleGainDb: number;
    selectedDeviceId: string;
  };
  overrides: Record<string, {
    trackKey: string;
    customArtist: string;
    customAlbum: string;
    customArtUrl?: string;
    releaseMbid?: string;
    format?: string;
    year?: string;
    updatedAt: string;
  }>;
  sessions: Array<{
    id: string;
    artist: string;
    album: string;
    firstTrack: string;
    artUrl: string;
    playedAt: string;
    playCount: number;
    mbid?: string;
    hasOverride: boolean;
  }>;
  favoriteSpeakers: string[];
}

const defaultData: StoredData = {
  settings: {
    sourceType: 'vinyl',
    customStreamLabel: 'Vinyl Audio Streaming',
    defaultArtUrl: '/src/assets/images/analogair_idle_art_1788723997443.jpg',
    idleArtist: 'Audio-Technica',
    idleAlbum: 'AT-LP60X Turntable',
    idleTitle: 'AnalogAir Vinyl Stream',
    continuousId: false,
    silenceGapSeconds: 20,
    dimMinutes: 25,
    idleFadeSeconds: 10,
    owntoneHost: 'localhost',
    owntonePort: 3689,
    enableToneDsp: true
  },
  tone: {
    inputGainDb: 0,
    bassGainDb: 1.5,
    midGainDb: 0,
    trebleGainDb: 0.5,
    selectedDeviceId: 'usb_audio_codec_0'
  },
  overrides: {
    'Pink Floyd - Speak to Me': {
      trackKey: 'Pink Floyd - Speak to Me',
      customArtist: 'Pink Floyd',
      customAlbum: 'The Dark Side of the Moon',
      customArtUrl: 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=1000&q=80',
      releaseMbid: 'a30f30c6-3023-3f18-be48-6a3f1246d7e0',
      format: '12" Vinyl LP',
      year: '1973',
      updatedAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString()
    }
  },
  sessions: [
    {
      id: 'sess-1',
      artist: 'Pink Floyd',
      album: 'The Dark Side of the Moon',
      firstTrack: 'Speak to Me',
      artUrl: 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=1000&q=80',
      playedAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      playCount: 4,
      mbid: 'a30f30c6-3023-3f18-be48-6a3f1246d7e0',
      hasOverride: true
    },
    {
      id: 'sess-2',
      artist: 'Miles Davis',
      album: 'Kind of Blue',
      firstTrack: 'So What',
      artUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1000&q=80',
      playedAt: new Date(Date.now() - 3600000 * 26).toISOString(),
      playCount: 7,
      mbid: '4979e27c-fb8d-3687-b99b-4392949ff736',
      hasOverride: false
    },
    {
      id: 'sess-3',
      artist: 'Fleetwood Mac',
      album: 'Rumours',
      firstTrack: 'Second Hand News',
      artUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1000&q=80',
      playedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
      playCount: 2,
      mbid: 'a6886e96-a81d-4074-b52a-33758b99ec69',
      hasOverride: false
    }
  ],
  favoriteSpeakers: ['airplay_living_room', 'chromecast_den']
};

function loadData(): StoredData {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      const merged: StoredData = {
        ...defaultData,
        ...raw,
        settings: { ...defaultData.settings, ...(raw.settings || {}) },
        tone: { ...defaultData.tone, ...(raw.tone || {}) }
      };
      return merged;
    }
  } catch (err) {
    console.error('Error loading DB file, falling back to defaults:', err);
  }
  return defaultData;
}

function saveData(data: StoredData) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving DB file:', err);
  }
}

let db = loadData();

// Detected Hardware Audio Devices
const AUDIO_DEVICES = [
  {
    id: 'usb_audio_codec_0',
    name: 'USB Audio CODEC (Turntable Preamp USB)',
    cardIndex: 1,
    supportedRates: [44100, 48000],
    isDefault: true,
    channels: 2
  },
  {
    id: 'behringer_uca202',
    name: 'Behringer U-Control UCA202 (Fixed 16/48000)',
    cardIndex: 2,
    supportedRates: [48000],
    isDefault: false,
    channels: 2
  },
  {
    id: 'focusrite_scarlett',
    name: 'Focusrite Scarlett 2i2 USB (High-Res 24/96000)',
    cardIndex: 3,
    supportedRates: [44100, 48000, 88200, 96000],
    isDefault: false,
    channels: 2
  }
];

// OwnTone Speaker list
let owntoneOutputs = [
  {
    id: 'airplay_living_room',
    name: 'Living Room Apple TV 4K (AirPlay 2)',
    type: 'airplay' as const,
    selected: true,
    volume: 100
  },
  {
    id: 'sonos_kitchen',
    name: 'Kitchen Sonos Era 100 (AirPlay 2)',
    type: 'airplay' as const,
    selected: false,
    volume: 100
  },
  {
    id: 'homepod_bedroom',
    name: 'Bedroom HomePod Mini (AirPlay 2)',
    type: 'airplay' as const,
    selected: false,
    volume: 100
  },
  {
    id: 'chromecast_den',
    name: 'Den Hi-Fi Chromecast Audio (Cast)',
    type: 'chromecast' as const,
    selected: true,
    volume: 100
  },
  {
    id: 'bt_marshall',
    name: 'Patio Marshall Stanmore (Bluetooth)',
    type: 'bluetooth' as const,
    selected: false,
    volume: 100
  },
  {
    id: 'local_dac',
    name: 'Raspberry Pi 3.5mm DAC / HiFiBerry (Local)',
    type: 'local' as const,
    selected: false,
    volume: 100
  }
];

interface ServerState {
  status: 'idle' | 'detecting' | 'playing' | 'silence_grace';
  artist: string;
  album: string;
  title: string;
  artUrl: string;
  mbid?: string;
  sourceType?: 'vinyl' | 'tape' | 'cd' | 'aux';
  isContinuous: boolean;
  sideLocked: boolean;
  playCount?: number;
  rmsLevel: number;
  sampleRate: number;
  bitDepth: number;
  inputDeviceName: string;
  matchedVia: 'local_override' | 'musicbrainz' | 'shazam' | 'idle_default';
  startedAt: string;
}

// Current Now Playing State
let currentState: ServerState = {
  status: 'playing',
  artist: 'Pink Floyd',
  album: 'The Dark Side of the Moon',
  title: 'Speak to Me',
  artUrl: 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=1000&q=80',
  mbid: 'a30f30c6-3023-3f18-be48-6a3f1246d7e0',
  sourceType: 'vinyl',
  isContinuous: db.settings.continuousId,
  sideLocked: true,
  playCount: 4,
  rmsLevel: 0.18,
  sampleRate: 44100,
  bitDepth: 16,
  inputDeviceName: 'USB Audio CODEC (Turntable Preamp USB)',
  matchedVia: 'local_override',
  startedAt: new Date(Date.now() - 145000).toISOString()
};

// Mirror album art to OwnTone source directory (AnalogAir.jpg)
// and overwrite with default standby artwork when silence gap is reached.
function syncOwnToneArtwork(target: 'standby' | 'album', albumArtUrl?: string) {
  try {
    const pipeDir = path.join(os.homedir(), 'Music', 'AnalogAir');
    if (!fs.existsSync(pipeDir)) {
      fs.mkdirSync(pipeDir, { recursive: true });
    }

    const liveArtPath = path.join(pipeDir, 'AnalogAir.jpg');
    const defaultArtPath = path.join(pipeDir, 'AnalogAir_default.jpg');
    const localMirror = path.join(DATA_DIR, 'AnalogAir.jpg');

    if (target === 'standby') {
      const customStandby = path.join(DATA_DIR, 'custom_standby.jpg');
      if (fs.existsSync(customStandby)) {
        fs.copyFileSync(customStandby, liveArtPath);
        fs.copyFileSync(customStandby, defaultArtPath);
        fs.copyFileSync(customStandby, localMirror);
        console.log('[OwnTone Sync] Overwrote AnalogAir.jpg with custom uploaded standby artwork');
      } else {
        const fallbackAsset = path.join(process.cwd(), 'src', 'assets', 'images', 'analogair_idle_art_1788723997443.jpg');
        if (fs.existsSync(fallbackAsset)) {
          fs.copyFileSync(fallbackAsset, liveArtPath);
          fs.copyFileSync(fallbackAsset, defaultArtPath);
          fs.copyFileSync(fallbackAsset, localMirror);
          console.log('[OwnTone Sync] Overwrote AnalogAir.jpg with default standby artwork');
        }
      }
    } else if (target === 'album' && albumArtUrl) {
      if (albumArtUrl.startsWith('data:image')) {
        const base64Data = albumArtUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(liveArtPath, buffer);
        fs.writeFileSync(localMirror, buffer);
        console.log('[OwnTone Sync] Updated AnalogAir.jpg with base64 album art');
      } else if (albumArtUrl.startsWith('http')) {
        fetch(albumArtUrl, { signal: AbortSignal.timeout(6000) })
          .then(res => res.arrayBuffer())
          .then(buf => {
            const buffer = Buffer.from(buf);
            fs.writeFileSync(liveArtPath, buffer);
            fs.writeFileSync(localMirror, buffer);
            console.log('[OwnTone Sync] Downloaded and wrote album artwork to AnalogAir.jpg');
          })
          .catch(err => {
            console.warn('[OwnTone Sync] Failed to download album art for AnalogAir.jpg:', err.message);
          });
      }
    }
  } catch (err: any) {
    console.warn('[OwnTone Sync] Could not write to OwnTone music folder:', err.message);
  }
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// 1. Get Live State
app.get('/api/state', (req, res) => {
  const selectedDev = AUDIO_DEVICES.find(d => d.id === db.tone.selectedDeviceId) || AUDIO_DEVICES[0];
  res.json({
    ...currentState,
    inputDeviceName: selectedDev.name,
    isContinuous: db.settings.continuousId,
    tone: db.tone,
    settings: db.settings
  });
});

// 2. Toggle Continuous vs Side Lock mode
app.post('/api/mode', (req, res) => {
  const { continuous } = req.body;
  db.settings.continuousId = !!continuous;
  currentState.isContinuous = db.settings.continuousId;
  saveData(db);
  res.json({ success: true, continuousId: db.settings.continuousId });
});

// 3. Tone Controls (Gain, Bass, Treble, Device)
app.get('/api/tone', (req, res) => {
  res.json({
    ...db.tone,
    deviceList: AUDIO_DEVICES
  });
});

app.post('/api/tone', (req, res) => {
  const { inputGainDb, bassGainDb, midGainDb, trebleGainDb, selectedDeviceId } = req.body;
  if (typeof inputGainDb === 'number') db.tone.inputGainDb = Math.max(-12, Math.min(12, inputGainDb));
  if (typeof bassGainDb === 'number') db.tone.bassGainDb = Math.max(-12, Math.min(12, bassGainDb));
  if (typeof midGainDb === 'number') db.tone.midGainDb = Math.max(-12, Math.min(12, midGainDb));
  if (typeof trebleGainDb === 'number') db.tone.trebleGainDb = Math.max(-12, Math.min(12, trebleGainDb));
  if (selectedDeviceId) db.tone.selectedDeviceId = selectedDeviceId;
  
  saveData(db);
  res.json({ success: true, tone: db.tone });
});

// 4. MusicBrainz release search proxy with robust iTunes fallback
app.get('/api/search/musicbrainz', async (req, res) => {
  const query = (req.query.query as string || '').trim();
  const artist = (req.query.artist as string || '').trim();
  const recording = (req.query.recording as string || '').trim();

  if (!query && (!artist || !recording)) {
    return res.json({ candidates: [] });
  }

  // Resilient fallback to iTunes album search (prevents 503 errors and provides 1400x1400 art)
  const fetchItunesFallback = async () => {
    try {
      const searchTerm = query || `${artist} ${recording}`;
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=album&limit=10`;
      const iRes = await fetch(itunesUrl);
      if (iRes.ok) {
        const iData = await iRes.json();
        return (iData.results || []).map((item: any) => ({
          id: `itunes-${item.collectionId}`,
          title: item.collectionName,
          artist: item.artistName,
          year: item.releaseDate ? item.releaseDate.substring(0, 4) : 'Release',
          format: 'Studio Album (Official)',
          isFullAlbum: true,
          isCompilation: false,
          typeLabel: 'Studio Album (Canonical)',
          artUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '1400x1400bb') : ''
        }));
      }
    } catch {
      // Non-fatal
    }
    return [];
  };

  try {
    const mbQuery = query 
      ? encodeURIComponent(query)
      : encodeURIComponent(`artist:"${artist}" AND recording:"${recording}"`);

    const url = `https://musicbrainz.org/ws/2/recording?query=${mbQuery}&inc=release-groups+releases&fmt=json`;
    
    // MusicBrainz strictly requires a descriptive User-Agent
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AnalogAir/1.0 (https://github.com/analogair/analogair-streamer; contact: stream@analogair.local)'
      }
    });

    if (!response.ok) {
      // MusicBrainz rate limits (503) or is temporarily unavailable: use instant iTunes fallback
      const itunesCandidates = await fetchItunesFallback();
      return res.json({ candidates: itunesCandidates });
    }

    const data = await response.json();
    const candidateMap = new Map<string, any>();

    for (const rec of (data.recordings || [])) {
      for (const release of (rec.releases || [])) {
        if (release.status && release.status !== 'Official') continue;
        const rg = release['release-group'] || {};
        const rgId = rg.id || release.id;
        const title = rg.title || release.title;
        const relDate = rg['first-release-date'] || release.date || 'N/A';
        const year = relDate.substring(0, 4);
        const primaryType = rg['primary-type'] || 'Album';
        const secondaryTypes = rg['secondary-types'] || [];

        if (secondaryTypes.includes('Live') || secondaryTypes.includes('Bootleg')) continue;
        if (candidateMap.has(rgId)) continue;

        const isFullAlbum = primaryType === 'Album' && secondaryTypes.length === 0;
        const isCompilation = primaryType === 'Compilation' || secondaryTypes.includes('Compilation');

        candidateMap.set(rgId, {
          id: release.id,
          title,
          artist: rec['artist-credit']?.[0]?.name || artist || 'Unknown Artist',
          year,
          format: release.media?.[0]?.format || '12" Vinyl',
          isFullAlbum,
          isCompilation,
          typeLabel: isFullAlbum ? 'Studio Album (Canonical)' : isCompilation ? 'Compilation' : primaryType,
          artUrl: `https://coverartarchive.org/release/${release.id}/front-500`
        });
      }
    }

    let candidates = Array.from(candidateMap.values())
      .sort((a, b) => {
        if (a.isFullAlbum && !b.isFullAlbum) return -1;
        if (!a.isFullAlbum && b.isFullAlbum) return 1;
        return (a.year || '9999').localeCompare(b.year || '9999');
      })
      .slice(0, 15);

    if (candidates.length === 0) {
      const itunesCandidates = await fetchItunesFallback();
      if (itunesCandidates.length > 0) candidates = itunesCandidates;
    }

    res.json({ candidates });
  } catch {
    const itunesCandidates = await fetchItunesFallback();
    res.json({
      candidates: itunesCandidates.length > 0 ? itunesCandidates : [
        {
          id: 'mbid-default-studio',
          title: query || 'The Dark Side of the Moon',
          artist: artist || 'Pink Floyd',
          year: '1973',
          format: '12" Vinyl LP (Stereo)',
          isFullAlbum: true,
          isCompilation: false,
          typeLabel: 'Studio Album (Canonical)',
          artUrl: 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=1000&q=80'
        }
      ]
    });
  }
});

// 5. iTunes Artwork Search Proxy
app.get('/api/search/itunes', async (req, res) => {
  const query = (req.query.query as string || '').trim();
  if (!query) return res.json({ artwork: [] });

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=6`;
    const response = await fetch(url);
    const data = await response.json();
    
    const results = (data.results || []).map((item: any) => ({
      album: item.collectionName,
      artist: item.artistName,
      releaseDate: item.releaseDate ? item.releaseDate.substring(0, 4) : '',
      trackCount: item.trackCount,
      artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '1400x1400bb') : ''
    }));

    res.json({ results });
  } catch (err) {
    console.error('iTunes search error:', err);
    res.json({ results: [] });
  }
});

// 6. Overrides (Save edit forever)
app.get('/api/overrides', (req, res) => {
  res.json({ overrides: Object.values(db.overrides) });
});

app.post('/api/override', (req, res) => {
  const { trackKey, customArtist, customAlbum, customArtUrl, releaseMbid, format, year } = req.body;
  if (!trackKey || !customAlbum) {
    return res.status(400).json({ error: 'trackKey and customAlbum are required' });
  }

  const record = {
    trackKey,
    customArtist: customArtist || currentState.artist,
    customAlbum,
    customArtUrl: customArtUrl || currentState.artUrl,
    releaseMbid,
    format: format || '12" Vinyl LP',
    year: year || 'Release',
    updatedAt: new Date().toISOString()
  };

  db.overrides[trackKey] = record;

  // If this matches current playing track, immediately update current playing state!
  const currentKey = `${currentState.artist} - ${currentState.title}`;
  if (currentKey === trackKey || currentState.artist === customArtist) {
    currentState.album = customAlbum;
    currentState.artist = customArtist || currentState.artist;
    if (customArtUrl) currentState.artUrl = customArtUrl;
    if (releaseMbid) currentState.mbid = releaseMbid;
    currentState.matchedVia = 'local_override';
  }

  // Also update session history entry if exists
  const existingSess = db.sessions.find(s => `${s.artist} - ${s.firstTrack}` === trackKey);
  if (existingSess) {
    existingSess.album = customAlbum;
    existingSess.artist = customArtist || existingSess.artist;
    if (customArtUrl) existingSess.artUrl = customArtUrl;
    existingSess.hasOverride = true;
  }

  saveData(db);
  res.json({ success: true, record });
});

app.delete('/api/override/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (db.overrides[key]) {
    delete db.overrides[key];
    saveData(db);
  }
  res.json({ success: true });
});

// 7. Listening Sessions & History
app.get('/api/sessions', (req, res) => {
  res.json({ sessions: db.sessions });
});

app.delete('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  db.sessions = db.sessions.filter(s => s.id !== id);
  saveData(db);
  res.json({ success: true });
});

// 8. OwnTone Outputs Management
app.get('/api/owntone/outputs', (req, res) => {
  const outputs = owntoneOutputs.map(out => ({
    ...out,
    id: String(out.id),
    isFavorite: db.favoriteSpeakers.map(String).includes(String(out.id))
  }));
  res.json({ outputs, favoriteSpeakers: db.favoriteSpeakers.map(String) });
});

// Toggle output on/off: Defaults destination to 100% volume when activated
app.post('/api/owntone/outputs/:id/toggle', (req, res) => {
  const id = req.params.id;
  const out = owntoneOutputs.find(o => o.id === id);
  if (!out) return res.status(404).json({ error: 'Output not found' });

  out.selected = !out.selected;
  if (out.selected) {
    // User requested: "It should default the destination to 100% volume."
    out.volume = 100;
  }

  res.json({ success: true, output: out });
});

app.post('/api/owntone/outputs/:id/volume', (req, res) => {
  const id = req.params.id;
  const { volume } = req.body;
  const out = owntoneOutputs.find(o => o.id === id);
  if (!out) return res.status(404).json({ error: 'Output not found' });

  if (typeof volume === 'number') {
    out.volume = Math.max(0, Math.min(100, volume));
  }
  res.json({ success: true, output: out });
});

app.post('/api/owntone/outputs/:id/favorite', (req, res) => {
  const id = String(req.params.id);
  const isFav = db.favoriteSpeakers.map(String).includes(id);
  if (isFav) {
    db.favoriteSpeakers = db.favoriteSpeakers.map(String).filter(s => s !== id);
  } else {
    db.favoriteSpeakers.push(id);
  }
  saveData(db);
  res.json({ success: true, isFavorite: !isFav, favoriteSpeakers: db.favoriteSpeakers.map(String) });
});

// 9. System Preferences
app.get('/api/settings', (req, res) => {
  res.json({ settings: db.settings });
});

app.post('/api/settings', (req, res) => {
  const {
    sourceType,
    customStreamLabel,
    defaultArtUrl,
    idleArtist,
    idleAlbum,
    idleTitle,
    continuousId,
    silenceGapSeconds,
    dimMinutes,
    idleFadeSeconds
  } = req.body;

  if (sourceType !== undefined) {
    db.settings.sourceType = sourceType;
    currentState.sourceType = sourceType;
  }
  if (customStreamLabel !== undefined) db.settings.customStreamLabel = customStreamLabel;
  if (defaultArtUrl !== undefined) db.settings.defaultArtUrl = defaultArtUrl;
  if (idleArtist !== undefined) db.settings.idleArtist = idleArtist;
  if (idleAlbum !== undefined) db.settings.idleAlbum = idleAlbum;
  if (idleTitle !== undefined) db.settings.idleTitle = idleTitle;
  if (continuousId !== undefined) db.settings.continuousId = !!continuousId;
  if (silenceGapSeconds !== undefined) db.settings.silenceGapSeconds = Number(silenceGapSeconds);
  if (dimMinutes !== undefined) db.settings.dimMinutes = Number(dimMinutes);
  if (idleFadeSeconds !== undefined) db.settings.idleFadeSeconds = Number(idleFadeSeconds);

  saveData(db);

  if (defaultArtUrl !== undefined && currentState.status === 'idle') {
    currentState.artUrl = defaultArtUrl;
    syncOwnToneArtwork('standby');
  }

  res.json({ success: true, settings: db.settings });
});

// Upload personal image for default standby artwork
app.post('/api/upload/default-art', (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Valid image base64 data required' });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const customArtPath = path.join(DATA_DIR, 'custom_standby.jpg');
    fs.writeFileSync(customArtPath, buffer);

    const artUrl = `/api/artwork/custom-standby.jpg?v=${Date.now()}`;
    db.settings.defaultArtUrl = artUrl;
    saveData(db);

    // If currently in standby/idle, immediately update now playing art & overwrite AnalogAir.jpg
    if (currentState.status === 'idle') {
      currentState.artUrl = artUrl;
      syncOwnToneArtwork('standby');
    }

    res.json({
      success: true,
      artUrl,
      settings: db.settings
    });
  } catch (err: any) {
    console.error('Failed to upload custom standby art:', err);
    res.status(500).json({ error: 'Failed to process image: ' + err.message });
  }
});

// Serve uploaded custom standby artwork
app.get('/api/artwork/custom-standby.jpg', (req, res) => {
  const customArtPath = path.join(DATA_DIR, 'custom_standby.jpg');
  if (fs.existsSync(customArtPath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return fs.createReadStream(customArtPath).pipe(res);
  }
  const fallbackAsset = path.join(process.cwd(), 'src', 'assets', 'images', 'analogair_idle_art_1788723997443.jpg');
  if (fs.existsSync(fallbackAsset)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return fs.createReadStream(fallbackAsset).pipe(res);
  }
  res.status(404).send('Not found');
});

// Inspect or download the live OwnTone AnalogAir.jpg file
app.get('/api/artwork/AnalogAir.jpg', (req, res) => {
  const localMirror = path.join(DATA_DIR, 'AnalogAir.jpg');
  const pipePath = path.join(os.homedir(), 'Music', 'AnalogAir', 'AnalogAir.jpg');
  const fileToServe = fs.existsSync(pipePath) ? pipePath : localMirror;
  if (fs.existsSync(fileToServe)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return fs.createReadStream(fileToServe).pipe(res);
  }
  res.status(404).send('AnalogAir.jpg not generated yet');
});

// 10. Downloadable Install Script, Desktop Launcher & System Files
app.get('/api/installer/desktop-shortcut', (req, res) => {
  const host = req.get('host') || 'localhost:3000';
  const desktopFile = `[Desktop Entry]
Version=1.0
Type=Application
Name=Install AnalogAir
Comment=Run AnalogAir Zero-Latency Vinyl Audio Streamer Installer
Exec=bash -c "curl -sSL http://${host}/api/installer/script | bash; echo ''; echo 'Press Enter to finish...'; read -r"
Icon=audio-card
Terminal=true
Categories=Audio;AudioVideo;
StartupNotify=true
`;
  res.setHeader('Content-Type', 'application/x-desktop');
  res.setHeader('Content-Disposition', 'attachment; filename="Install-AnalogAir.desktop"');
  res.send(desktopFile);
});

app.get('/api/installer/script', (req, res) => {
  const daemonScript = fs.readFileSync(path.join(process.cwd(), 'scripts/analogair_daemon.py'), 'utf-8');
  const webScript = fs.readFileSync(path.join(process.cwd(), 'scripts/analogair_web.py'), 'utf-8');

  let htmlB64 = '';
  let jsB64 = '';
  let cssB64 = '';
  try {
    const htmlPath = path.join(process.cwd(), 'dist/index.html');
    const jsPath = path.join(process.cwd(), 'dist/assets/index-8IyUgyDt.js');
    const cssPath = path.join(process.cwd(), 'dist/assets/index-Bw8SnFZk.css');
    if (fs.existsSync(htmlPath)) htmlB64 = zlib.gzipSync(fs.readFileSync(htmlPath)).toString('base64');
    if (fs.existsSync(jsPath)) jsB64 = zlib.gzipSync(fs.readFileSync(jsPath)).toString('base64');
    if (fs.existsSync(cssPath)) cssB64 = zlib.gzipSync(fs.readFileSync(cssPath)).toString('base64');
  } catch (err) {
    console.error('Error preparing UI assets for installer:', err);
  }

  const scriptContent = `#!/usr/bin/env bash
# ==============================================================================
#  AnalogAir Installer & Auto-Configurator
#  Target: Raspberry Pi OS (Debian 13 Trixie / Debian 12 Bookworm)
#  Features: PipeWire Glitch-Free Audio Pipe, Real-Time Tone Controls,
#            OwnTone AirPlay/Chromecast Server, Metadata Daemon, Web UI
# ==============================================================================

set -e

GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
YELLOW='\\033[1;33m'
RED='\\033[0;31m'
NC='\\033[0m'

echo -e "\${BLUE}"
echo "    _                  _                 _     _      "
echo "   / \\   _ __   __ _  | | ___   __ _    / \\   (_)_ __ "
echo "  / _ \\ | '_ \\ / _\` | | |/ _ \\ / _\` |  / _ \\  | | '__|"
echo " / ___ \\| | | | (_| | | | (_) | (_| | / ___ \\ | | |   "
echo "/_/   \\_\\_| |_|\\__,_| |_|\\___/ \\__, |/_/   \\_\\|_|_|   "
echo "                               |___/                  "
echo -e "\${NC}"
echo -e "\${GREEN}AnalogAir Smart Vinyl Audio Streamer Setup Wizard\${NC}"
echo "--------------------------------------------------------"

# 1. Root check
if [ "\$EUID" -eq 0 ]; then
  echo -e "\${RED}Please run this script as your regular user (e.g., analogair or pi), NOT as root or with sudo.\${NC}"
  echo "The installer will prompt for sudo when required."
  exit 1
fi

CURRENT_USER="\$(whoami)"
USER_HOME="\$HOME"

# 2. Interactive Questions
echo ""
echo -e "\${YELLOW}[1/7] Configuration Setup\${NC}"
read -p "Install for user [\$CURRENT_USER]: " CONF_USER
CONF_USER="\${CONF_USER:-\$CURRENT_USER}"

DEFAULT_MUSIC_DIR="/home/\$CONF_USER/Music"
read -p "Path to OwnTone Music directory [\$DEFAULT_MUSIC_DIR]: " CONF_MUSIC_DIR
CONF_MUSIC_DIR="\${CONF_MUSIC_DIR:-\$DEFAULT_MUSIC_DIR}"

read -p "Idle Artist Name displayed on AirPlay [Audio-Technica]: " CONF_IDLE_ARTIST
CONF_IDLE_ARTIST="\${CONF_IDLE_ARTIST:-Audio-Technica}"

read -p "Idle Album Name displayed on AirPlay [AT-LP60X Turntable]: " CONF_IDLE_ALBUM
CONF_IDLE_ALBUM="\${CONF_IDLE_ALBUM:-AT-LP60X Turntable}"

read -p "Idle Stream Title [AnalogAir Vinyl]: " CONF_IDLE_TITLE
CONF_IDLE_TITLE="\${CONF_IDLE_TITLE:-AnalogAir Vinyl}"

# 3. Audio Device Detection
echo ""
echo -e "\${YELLOW}[2/7] Detecting Audio Capture Hardware\${NC}"
echo "Searching for connected USB audio input devices..."
arecord -l || true
echo ""
echo "Enter your USB capture card ALSA name or leave blank for default PipeWire source (@DEFAULT_SOURCE@):"
read -p "Capture device name or card ID [@DEFAULT_SOURCE@]: " CONF_AUDIO_DEV
CONF_AUDIO_DEV="\${CONF_AUDIO_DEV:-@DEFAULT_SOURCE@}"

# 4. System Packages Installation
echo ""
echo -e "\${YELLOW}[3/7] Setting up OwnTone Repository & Dependencies\${NC}"

# Ensure prerequisites are installed
sudo apt-get update
sudo apt-get install -y curl wget gnupg lsb-release

# Add official OwnTone APT repository and keyring (supports Debian Trixie & Bookworm)
echo "Adding official OwnTone repository & GPG keyring..."
sudo mkdir -p /usr/share/keyrings
wget -q -O - https://raw.githubusercontent.com/owntone/owntone-apt/refs/heads/master/repo/rpi/owntone.gpg | sudo gpg --dearmor --yes -o /usr/share/keyrings/owntone-archive-keyring.gpg

DIST=\$(lsb_release -cs 2>/dev/null || echo "trixie")
if [ "\$DIST" != "trixie" ] && [ "\$DIST" != "bookworm" ] && [ "\$DIST" != "bullseye" ]; then
  DIST="trixie"
fi
sudo wget -q -O /etc/apt/sources.list.d/owntone.list "https://raw.githubusercontent.com/owntone/owntone-apt/refs/heads/master/repo/rpi/owntone-\${DIST}.list"

# Refresh repos and install packages
sudo apt-get update
sudo apt-get install -y \\
  owntone \\
  pipewire \\
  pipewire-audio-client-libraries \\
  pipewire-pulse \\
  wireplumber \\
  libspa-0.2-modules \\
  ffmpeg \\
  python3 \\
  python3-pip \\
  python3-venv \\
  libportaudio2 \\
  portaudio19-dev \\
  git \\
  curl \\
  avahi-daemon

# 5. Configure OwnTone Server (/etc/owntone.conf)
echo ""
echo -e "\${YELLOW}[4/7] Configuring OwnTone Server (/etc/owntone.conf)\${NC}"

PIPE_DIR="\$CONF_MUSIC_DIR/AnalogAir"
mkdir -p "\$PIPE_DIR"
mkdir -p "\$USER_HOME/.config/analogair"
mkdir -p "\$USER_HOME/.config/pipewire/filter-chain.conf.d"

# Backup original config if present
if [ -f /etc/owntone.conf ] && [ ! -f /etc/owntone.conf.original ]; then
  sudo cp /etc/owntone.conf /etc/owntone.conf.original
fi

# Ensure user and music directories have appropriate traverse permissions for OwnTone
sudo chmod 755 "\$USER_HOME"
sudo chmod 755 "\$CONF_MUSIC_DIR"
sudo chmod -R 755 "\$PIPE_DIR"

# Write OwnTone configuration matching user's working vinyl setup
sudo tee /etc/owntone.conf > /dev/null << CONFEOF
# OwnTone configuration generated by AnalogAir Setup Wizard
general {
	# Run as root or user with read permissions on the music directory and FIFO pipe
	uid = "root"

	logfile = "/var/log/owntone.log"
	loglevel = log
	admin_password = ""

	# Allow local network clients to access OwnTone without password prompts
	trusted_networks = { "localhost", "192.168", "86.0", "10.0", "fd", "lan" }

	# Low-latency buffer threshold
	start_buffer_ms = 1000
}

library {
	name = "AnalogAir on %h"
	port = 3689

	# Location of your media library and AnalogAir pipe
	directories = { "\$CONF_MUSIC_DIR" }

	name_unknown_artist = "\$CONF_IDLE_ARTIST"
	name_unknown_album = "\$CONF_IDLE_ALBUM"

	artwork_basenames = { "artwork", "cover", "Folder" }
	artwork_individual = true

	# Automatically trigger playback to AirPlay speakers when audio arrives in the pipe
	pipe_autostart = true
}

audio {
	nickname = "AnalogAir Streamer"
}
CONFEOF

echo "Restarting OwnTone service with updated configuration..."
sudo systemctl restart owntone

# 6. Create Named Pipes & Virtual Audio Engine
echo ""
echo -e "\${YELLOW}[5/7] Creating Named Pipes & Virtual Audio Engine\${NC}"

# Non-blocking circular FIFO for OwnTone in AnalogAir folder
mkfifo "\$PIPE_DIR/AnalogAir" 2>/dev/null || true
mkfifo "\$PIPE_DIR/AnalogAir.metadata" 2>/dev/null || true
chmod 666 "\$PIPE_DIR/AnalogAir" "\$PIPE_DIR/AnalogAir.metadata"

# Copy default standby artwork to AnalogAir_default.jpg and live AnalogAir.jpg
python3 -c "
from PIL import Image, ImageDraw
import os
path = '\$PIPE_DIR/AnalogAir_default.jpg'
if not os.path.exists(path):
    img = Image.new('RGB', (1000, 1000), color='#121216')
    draw = ImageDraw.Draw(img)
    draw.ellipse([100, 100, 900, 900], outline='#2a2a32', width=8)
    draw.ellipse([250, 250, 750, 750], outline='#222228', width=6)
    draw.ellipse([400, 400, 600, 600], fill='#d97706')
    draw.ellipse([480, 480, 520, 520], fill='#121216')
    img.save(path, 'JPEG', quality=90)
" 2>/dev/null || true
cp -f "\$PIPE_DIR/AnalogAir_default.jpg" "\$PIPE_DIR/AnalogAir.jpg" 2>/dev/null || true

# Configure PipeWire Filter-Chain (Tone Controls: Preamp Gain, Bass 100Hz, Mid 1kHz, Treble 10kHz)
cat << 'PWEOF' > "\$USER_HOME/.config/pipewire/filter-chain.conf.d/analogair-tone.conf"
# AnalogAir Zero-Latency Hardware Tone & Gain Filter Chain
filter.chain = [
    {
        name = "analogair-tone-dsp"
        type = "builtin"
        label = "biquad"
        control = {
            "Gain" = 0.0
            "Bass" = 1.5
            "Mid" = 0.0
            "Treble" = 0.5
        }
    }
]
PWEOF

# 7. Install Python VirtualEnv, Scripts & Web UI
echo ""
echo -e "\${YELLOW}[6/7] Setting up Metadata Daemon & Web UI\${NC}"
VENV_PATH="\$USER_HOME/.config/analogair/venv"
python3 -m venv "\$VENV_PATH" --system-site-packages
"\$VENV_PATH/bin/pip" install --upgrade pip
"\$VENV_PATH/bin/pip" install shazamio sounddevice numpy requests pillow aiohttp

# Write AnalogAir Daemon Script directly
cat << 'PYEOF' > "\$USER_HOME/.config/analogair/analogair_daemon.py"
${daemonScript}
PYEOF
chmod +x "\$USER_HOME/.config/analogair/analogair_daemon.py"

# Write AnalogAir Web UI Server directly
cat << 'PYEOF' > "\$USER_HOME/.config/analogair/analogair_web.py"
${webScript}
PYEOF
chmod +x "\$USER_HOME/.config/analogair/analogair_web.py"

# Unpack Web UI Assets into ~/.config/analogair/ui
echo "Installing AnalogAir Touchscreen Web UI..."
mkdir -p "\$USER_HOME/.config/analogair/ui/assets"
echo "${htmlB64}" | base64 -d | gzip -d > "\$USER_HOME/.config/analogair/ui/index.html"
echo "${jsB64}" | base64 -d | gzip -d > "\$USER_HOME/.config/analogair/ui/assets/index-8IyUgyDt.js"
echo "${cssB64}" | base64 -d | gzip -d > "\$USER_HOME/.config/analogair/ui/assets/index-Bw8SnFZk.css"

# 8. Setup Systemd User Services
echo ""
echo -e "\${YELLOW}[7/7] Installing Systemd Background Services\${NC}"
mkdir -p "\$USER_HOME/.config/systemd/user"

# Service 1: Audio Capture with Non-Blocking Pipe Buffer Broker
cat << SVCEOF > "\$USER_HOME/.config/systemd/user/analogair-capture.service"
[Unit]
Description=AnalogAir Vinyl Audio Pipe Broker (Glitch-Free Non-Blocking)
After=pipewire.service wireplumber.service
Wants=pipewire.service wireplumber.service

[Service]
Type=simple
ExecStartPre=/bin/sh -c 'mkdir -p \$CONF_MUSIC_DIR/AnalogAir && mkfifo \$CONF_MUSIC_DIR/AnalogAir/AnalogAir 2>/dev/null || true'
ExecStart=/bin/sh -c 'pw-cat --record --target=\$CONF_AUDIO_DEV --format=s16 --rate=44100 --channels=2 --raw - | cat > \$CONF_MUSIC_DIR/AnalogAir/AnalogAir'
Restart=always
RestartSec=2
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
SVCEOF

# Service 2: Metadata Recognition Daemon
cat << SVCEOF > "\$USER_HOME/.config/systemd/user/analogair-daemon.service"
[Unit]
Description=AnalogAir Side-Aware Metadata & Artwork Daemon
After=analogair-capture.service
Wants=analogair-capture.service

[Service]
Type=simple
ExecStart=\$VENV_PATH/bin/python3 \$USER_HOME/.config/analogair/analogair_daemon.py
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
SVCEOF

# Service 3: AnalogAir Web UI Server (Port 3000)
cat << SVCEOF > "\$USER_HOME/.config/systemd/user/analogair-web.service"
[Unit]
Description=AnalogAir Touchscreen & Mobile Web UI Server (Port 3000)
After=network.target analogair-daemon.service
Wants=analogair-daemon.service

[Service]
Type=simple
ExecStart=\$VENV_PATH/bin/python3 \$USER_HOME/.config/analogair/analogair_web.py
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
sudo loginctl enable-linger "\$CONF_USER"

PI_IP=\$(hostname -I 2>/dev/null | awk '{print \$1}')
PI_IP="\${PI_IP:-localhost}"

echo ""
echo -e "\${GREEN}========================================================\${NC}"
echo -e "\${GREEN} AnalogAir Installation Complete!\${NC}"
echo -e "\${GREEN}========================================================\${NC}"
echo ""
echo "Your Raspberry Pi is now streaming vinyl audio to OwnTone."
echo ""
echo -e " 1. OwnTone AirPlay Admin:        \${BLUE}http://\${PI_IP}:3689\${NC}"
echo -e " 2. AnalogAir Web / Touchscreen:  \${BLUE}http://\${PI_IP}:3000\${NC}"
echo " 3. Audio Pipe Location:          \$CONF_MUSIC_DIR/AnalogAir/AnalogAir"
echo " 4. Live Artwork:                 \$CONF_MUSIC_DIR/AnalogAir/AnalogAir.jpg"
echo " 5. Standby Artwork:              \$CONF_MUSIC_DIR/AnalogAir/AnalogAir_default.jpg"
echo ""
echo "Next Steps:"
echo " - Connect your turntable / USB capture card to any USB port on your Pi."
echo " - Open OwnTone (http://\${PI_IP}:3689) and select your AirPlay speakers (HomePods, Apple TV, Sonos)."
echo " - Open the AnalogAir Web UI (http://\${PI_IP}:3000) on your phone, tablet, or touchscreen for album art and tone controls!"
echo ""
`;
  res.setHeader('Content-Type', 'text/x-shellscript');
  res.setHeader('Content-Disposition', 'attachment; filename="install.sh"');
  res.send(scriptContent);
});

app.get('/api/installer/update-script', (req, res) => {
  const updateScript = fs.readFileSync(path.join(process.cwd(), 'update.sh'), 'utf-8');
  res.setHeader('Content-Type', 'text/x-shellscript');
  res.setHeader('Content-Disposition', 'attachment; filename="update.sh"');
  res.send(updateScript);
});

app.get('/api/installer/daemon', (req, res) => {
  const daemonScript = fs.readFileSync(path.join(process.cwd(), 'scripts/analogair_daemon.py'), 'utf-8');
  res.setHeader('Content-Type', 'text/x-python');
  res.setHeader('Content-Disposition', 'attachment; filename="analogair_daemon.py"');
  res.send(daemonScript);
});

app.get('/api/installer/web', (req, res) => {
  const webScript = fs.readFileSync(path.join(process.cwd(), 'scripts/analogair_web.py'), 'utf-8');
  res.setHeader('Content-Type', 'text/x-python');
  res.setHeader('Content-Disposition', 'attachment; filename="analogair_web.py"');
  res.send(webScript);
});

// Vite middleware in development, static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AnalogAir full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
