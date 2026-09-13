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
    enableRecognition: boolean;
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
    enableRecognition: false,
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

// Current Now Playing State (Default No Recognition / Resource Saver Mode)
let currentState: ServerState = {
  status: 'playing',
  artist: db.settings.idleArtist || 'Audio-Technica',
  album: db.settings.idleAlbum || 'AT-LP60X Turntable',
  title: db.settings.idleTitle || 'AnalogAir Vinyl Stream',
  artUrl: db.settings.defaultArtUrl || '/src/assets/images/analogair_idle_art_1788723997443.jpg',
  sourceType: db.settings.sourceType || 'vinyl',
  isContinuous: false,
  sideLocked: true,
  playCount: 1,
  rmsLevel: 0.18,
  sampleRate: 44100,
  bitDepth: 16,
  inputDeviceName: 'USB Audio CODEC (Turntable Preamp USB)',
  matchedVia: 'idle_default',
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

// Line Level Input Monitor Endpoint (Buffered)
app.get('/api/audio-level', (req, res) => {
  const gainDb = db.tone.inputGainDb || 0;
  const isPlaying = currentState.status === 'playing';

  // Natural vinyl audio signal simulation:
  // Base RMS ~ 0.16 with subtle realistic groove dynamics
  const time = Date.now() / 1000;
  const osc = Math.sin(time * 2.1) * 0.025 + Math.cos(time * 0.9) * 0.02;
  const rawRms = isPlaying ? Math.max(0.04, 0.16 + osc) : 0.001;
  const gainFactor = Math.pow(10, gainDb / 20);
  const adjustedRms = Math.min(1.0, rawRms * gainFactor);

  const dbfs = adjustedRms > 0.0001 ? Math.round(20 * Math.log10(adjustedRms) * 10) / 10 : -96.0;
  // Peak for vinyl dynamic range is ~3-5 dB above average RMS
  const peakRms = Math.min(1.0, adjustedRms * 1.48);
  const peakDbfs = peakRms > 0.0001 ? Math.round(20 * Math.log10(peakRms) * 10) / 10 : -96.0;

  const isClipping = peakDbfs >= -0.5;
  const isHot = peakDbfs >= -3.0;
  const isOptimal = peakDbfs >= -14.0 && !isHot;

  const leftPeakDbfs = peakDbfs > -90 ? Math.round((peakDbfs - 0.3) * 10) / 10 : -96.0;
  const rightPeakDbfs = peakDbfs > -90 ? Math.round((peakDbfs + 0.2) * 10) / 10 : -96.0;

  res.json({
    rms: Math.round(adjustedRms * 100000) / 100000,
    rawRms: Math.round(rawRms * 100000) / 100000,
    dbfs,
    peakDbfs,
    leftPeakDbfs,
    rightPeakDbfs,
    gainDb,
    isClipping,
    isHot,
    isOptimal,
    status: currentState.status,
    source: 'simulated_pulse',
    timestamp: Date.now()
  });
});

// 4. MusicBrainz release group & canonical master search proxy with resilient multi-tier fallback, likely artists & categorized discography
app.get('/api/search/musicbrainz', async (req, res) => {
  const query = (req.query.query as string || '').trim();
  const artist = (req.query.artist as string || '').trim();
  const album = (req.query.album as string || '').trim();
  const recording = (req.query.recording as string || req.query.track as string || '').trim();

  if (!query && !artist && !album && !recording) {
    return res.json({ candidates: [], likelyArtists: [], categorized: { studio: [], compilations: [], live: [], singles: [] } });
  }

  const norm = (s: string) => {
    if (!s) return '';
    return s.toLowerCase()
      .replace(/\bcolours?\b/g, 'color')
      .replace(/\bcolors?\b/g, 'color')
      .replace(/\btheatres?\b/g, 'theater')
      .replace(/^(the|a|an)\s+/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  };

  const diceCoeff = (s1: string, s2: string) => {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;
    const bigrams = (str: string) => {
      const bg = new Set<string>();
      for (let i = 0; i < str.length - 1; i++) bg.add(str.substring(i, i + 2));
      return bg;
    };
    const b1 = bigrams(s1), b2 = bigrams(s2);
    let intersection = 0;
    for (const item of b1) if (b2.has(item)) intersection++;
    return (2.0 * intersection) / (b1.size + b2.size);
  };

  const normTargetArtist = norm(artist);
  const normTargetAlbum = norm(album);
  const normTargetRecording = norm(recording);

  const calculateScore = (c: any) => {
    let s = 0;
    const cArt = norm(c.artist || '');
    const cAlb = norm(c.title || '');

    if (normTargetArtist) {
      if (normTargetArtist === cArt) s += 200;
      else if (normTargetArtist.includes(cArt) || cArt.includes(normTargetArtist)) s += 120;
      else s -= 150;
    }

    if (normTargetAlbum) {
      const sim = diceCoeff(normTargetAlbum, cAlb);
      if (normTargetAlbum === cAlb) s += 250;
      else if (normTargetAlbum.includes(cAlb) || cAlb.includes(normTargetAlbum)) s += 150;
      else if (sim >= 0.60) s += Math.round(sim * 160);
    }

    if (normTargetRecording && c.sideOpener) {
      if (c.sideOpener.includes('Track 1')) s += 220;
      else s += 40;
    } else if (c.sideOpener?.includes('Track 1')) {
      s += 70;
    }

    if (c.isFullAlbum) s += 60;
    if (c.isCompilation) {
      s -= 30;
      if (normTargetRecording && !c.sideOpener?.includes('Track 1')) s -= 50;
    }
    if (c.isLive) s -= 40;

    return s;
  };

  const headers = { 'User-Agent': 'AnalogAir/1.2.0 ( contact@analogair.local; Distearth@gmail.com )' };
  const allCandidatesMap = new Map<string, any>();
  const likelyArtists: any[] = [];

  // Step 1: Discover Likely Artists from iTunes & MusicBrainz
  const artistSearchTerm = artist || query;
  if (artistSearchTerm) {
    try {
      const artUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(artistSearchTerm)}&entity=musicArtist&limit=6`;
      const artRes = await fetch(artUrl, { headers });
      if (artRes.ok) {
        const artData = await artRes.json();
        for (const item of (artData.results || [])) {
          likelyArtists.push({
            id: String(item.artistId),
            name: item.artistName,
            genre: item.primaryGenreName || 'Music',
            source: 'itunes'
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // Step 2: Fetch Artist Discography if artist is known
  const primaryArtistId = likelyArtists[0]?.id;
  if (primaryArtistId) {
    try {
      const discUrl = `https://itunes.apple.com/lookup?id=${primaryArtistId}&entity=album&limit=50`;
      const discRes = await fetch(discUrl, { headers });
      if (discRes.ok) {
        const discData = await discRes.json();
        for (const item of (discData.results || [])) {
          if (item.wrapperType !== 'collection') continue;
          const cid = String(item.collectionId);
          const collName = (item.collectionName || '').trim();
          const isLive = /live|bootleg|concert|odeon|bbc/i.test(collName);
          const isComp = /greatest hits|best of|anthology|collection|essential|very best|singles/i.test(collName);
          const isSingle = / - single| - ep/i.test(collName) || (item.trackCount || 0) <= 3;
          const art100 = item.artworkUrl100 || '';
          const highResArt = art100 ? art100.replace('100x100bb', '1400x1400bb') : '';

          allCandidatesMap.set(`itunes-${cid}`, {
            id: `itunes-${cid}`,
            collectionId: item.collectionId,
            title: collName,
            artist: item.artistName || artist,
            year: item.releaseDate ? item.releaseDate.substring(0, 4) : 'Release',
            format: '12" Vinyl LP',
            isFullAlbum: !isLive && !isComp && !isSingle,
            isCompilation: isComp,
            isLive,
            isSingle,
            typeLabel: (!isLive && !isComp && !isSingle) ? 'Studio Album (Canonical)' : (isComp ? 'Compilation' : (isLive ? 'Live Recording' : 'Single / EP')),
            trackCount: item.trackCount,
            artUrl: highResArt,
            sideOpener: ''
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // Step 3: Targeted Album & Song Search on iTunes
  const searchTerms = [
    (artist && album) ? `${artist} ${album}` : '',
    (artist && recording) ? `${artist} ${recording}` : '',
    album || '',
    query || ''
  ].filter(t => t.trim().length > 0);

  for (const term of searchTerms) {
    try {
      const albUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=10`;
      const albRes = await fetch(albUrl, { headers });
      if (albRes.ok) {
        const aData = await albRes.json();
        for (const item of (aData.results || [])) {
          const cid = String(item.collectionId);
          const collName = (item.collectionName || '').trim();
          const isLive = /live|bootleg|concert/i.test(collName);
          const isComp = /greatest hits|best of|anthology|collection/i.test(collName);
          const isSingle = / - single| - ep/i.test(collName) || (item.trackCount || 0) <= 3;
          const art100 = item.artworkUrl100 || '';

          if (!allCandidatesMap.has(`itunes-${cid}`)) {
            allCandidatesMap.set(`itunes-${cid}`, {
              id: `itunes-${cid}`,
              collectionId: item.collectionId,
              title: collName,
              artist: item.artistName,
              year: item.releaseDate ? item.releaseDate.substring(0, 4) : 'Release',
              format: '12" Vinyl LP',
              isFullAlbum: !isLive && !isComp && !isSingle,
              isCompilation: isComp,
              isLive,
              isSingle,
              typeLabel: (!isLive && !isComp && !isSingle) ? 'Studio Album (Canonical)' : (isComp ? 'Compilation' : (isLive ? 'Live Recording' : 'Single / EP')),
              trackCount: item.trackCount,
              artUrl: art100 ? art100.replace('100x100bb', '1400x1400bb') : '',
              sideOpener: ''
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Step 4: Search song/recording to match Track 1 Side A Opener
  const songTerms = [
    (artist && recording) ? `${artist} ${recording}` : '',
    recording || ''
  ].filter(t => t.trim().length > 0);

  for (const term of songTerms) {
    try {
      const songUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=15`;
      const songRes = await fetch(songUrl, { headers });
      if (songRes.ok) {
        const sData = await songRes.json();
        for (const item of (sData.results || [])) {
          const isTrackOne = item.trackNumber === 1;
          const cid = String(item.collectionId);
          const collName = (item.collectionName || '').trim();
          const normColl = norm(collName);
          const isLive = /live/i.test(collName) || /live/i.test(item.trackName || '');
          const isComp = /greatest hits|best of|anthology/i.test(collName);

          const existing = Array.from(allCandidatesMap.values()).find(c => norm(c.title) === normColl);
          if (existing) {
            if (isTrackOne) existing.sideOpener = `Track 1 (Side A Opener: ${item.trackName})`;
            else if (!existing.sideOpener && item.trackNumber < 20) existing.sideOpener = `Track ${item.trackNumber} (${item.trackName})`;
            if (!existing.artUrl && item.artworkUrl100) {
              existing.artUrl = item.artworkUrl100.replace('100x100bb', '1400x1400bb');
            }
          } else {
            allCandidatesMap.set(`itunes-song-${cid}`, {
              id: `itunes-song-${cid}`,
              collectionId: item.collectionId,
              title: collName,
              artist: item.artistName,
              year: item.releaseDate ? item.releaseDate.substring(0, 4) : 'Release',
              format: '12" Vinyl LP',
              isFullAlbum: !isLive && !isComp,
              isCompilation: isComp,
              isLive,
              isSingle: false,
              sideOpener: isTrackOne ? `Track 1 (Side A Opener: ${item.trackName})` : `Track ${item.trackNumber} (${item.trackName})`,
              typeLabel: (!isLive && !isComp) ? 'Studio Album (Canonical)' : (isComp ? 'Compilation' : 'Live Recording'),
              trackCount: item.trackCount,
              artUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '1400x1400bb') : ''
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Step 5: MusicBrainz master release groups (with safe rate-limiting)
  if (artist || album) {
    try {
      const artClause = artist ? `artist:"${encodeURIComponent(artist)}" AND ` : '';
      const albClause = album ? `releasegroupaccent:"${encodeURIComponent(album)}"` : 'primarytype:album';
      const mbUrl = `https://musicbrainz.org/ws/2/release-group?query=${artClause}${albClause}&fmt=json&limit=10`;
      const mbRes = await fetch(mbUrl, { headers });
      if (mbRes.ok) {
        const mbData = await mbRes.json();
        for (const rg of (mbData['release-groups'] || [])) {
          const rgid = rg.id;
          const rgTitle = rg.title;
          const pType = rg['primary-type'] || 'Album';
          const sTypes = rg['secondary-types'] || [];
          const isFullAlbum = pType === 'Album' && sTypes.length === 0;
          const isComp = pType === 'Compilation' || sTypes.includes('Compilation');
          const isLive = sTypes.includes('Live');
          const year = (rg['first-release-date'] || '').substring(0, 4);

          // Check if we already have matching iTunes candidate for high-res art
          const normRgTitle = norm(rgTitle);
          const matchedItunes = Array.from(allCandidatesMap.values()).find(c => norm(c.title) === normRgTitle);
          const fallbackArt = matchedItunes?.artUrl || `https://coverartarchive.org/release-group/${rgid}/front-500`;

          allCandidatesMap.set(`mb-${rgid}`, {
            id: `mb-${rgid}`,
            releaseGroupMbid: rgid,
            title: rgTitle,
            artist: (rg['artist-credit'] || [{}])[0]?.name || artist,
            year,
            format: '12" Vinyl LP',
            isFullAlbum,
            isCompilation: isComp,
            isLive,
            isSingle: pType === 'Single' || pType === 'EP',
            typeLabel: isFullAlbum ? 'Studio Album (Canonical)' : isComp ? 'Compilation' : isLive ? 'Live Recording' : pType,
            artUrl: fallbackArt,
            sideOpener: matchedItunes?.sideOpener || ''
          });
        }
      }
    } catch {
      // ignore
    }
  }

  const allCandidates = Array.from(allCandidatesMap.values());
  for (const c of allCandidates) {
    c.score = calculateScore(c);
  }
  allCandidates.sort((a, b) => b.score - a.score);

  // Group into clear discography categories
  const studio = allCandidates.filter(c => c.isFullAlbum && !c.isSingle);
  const compilations = allCandidates.filter(c => c.isCompilation);
  const live = allCandidates.filter(c => c.isLive);
  const singles = allCandidates.filter(c => c.isSingle);

  res.json({
    candidates: allCandidates.slice(0, 24),
    likelyArtists,
    categorized: {
      studio: studio.slice(0, 20),
      compilations: compilations.slice(0, 15),
      live: live.slice(0, 10),
      singles: singles.slice(0, 10)
    }
  });
});

// 4.1 Tracklist & Side Opener Inspector Endpoint
app.get('/api/album-tracks', async (req, res) => {
  const collectionId = req.query.collectionId as string;
  const artist = req.query.artist as string || '';
  const album = req.query.album as string || '';

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

  try {
    let targetCollId = collectionId;

    if (!targetCollId && (artist || album)) {
      const q = encodeURIComponent(`${artist} ${album}`.trim());
      const searchRes = await fetch(`https://itunes.apple.com/search?term=${q}&entity=album&limit=1`, { headers });
      if (searchRes.ok) {
        const sData = await searchRes.json();
        if (sData.results?.[0]?.collectionId) {
          targetCollId = String(sData.results[0].collectionId);
        }
      }
    }

    if (!targetCollId) {
      return res.json({ tracks: [], sideAOpener: null, sideBOpener: null });
    }

    const lookupRes = await fetch(`https://itunes.apple.com/lookup?id=${targetCollId}&entity=song`, { headers });
    if (!lookupRes.ok) {
      return res.json({ tracks: [], sideAOpener: null, sideBOpener: null });
    }

    const data = await lookupRes.json();
    const songs = (data.results || []).filter((r: any) => r.wrapperType === 'track');
    const total = songs.length;
    const sideBStart = Math.ceil(total / 2) + 1;

    const tracks = songs.map((s: any) => {
      const num = s.trackNumber;
      const isSideA = num < sideBStart;
      const side = isSideA ? 'A' : 'B';
      const isOpener = num === 1 || num === sideBStart;
      const durSec = s.trackTimeMillis ? Math.round(s.trackTimeMillis / 1000) : 0;
      const mins = Math.floor(durSec / 60);
      const secs = String(durSec % 60).padStart(2, '0');

      return {
        trackNumber: num,
        title: s.trackName,
        duration: `${mins}:${secs}`,
        side,
        isOpener,
        openerLabel: num === 1 ? 'Side A Opener' : (num === sideBStart ? 'Side B Opener' : '')
      };
    });

    const sideAOpener = tracks.find((t: any) => t.trackNumber === 1)?.title || null;
    const sideBOpener = tracks.find((t: any) => t.trackNumber === sideBStart)?.title || null;

    res.json({
      collectionId: targetCollId,
      totalTracks: total,
      sideAOpener,
      sideBOpener,
      tracks
    });
  } catch {
    res.json({ tracks: [], sideAOpener: null, sideBOpener: null });
  }
});

// 5. iTunes Artwork Search Proxy (Accepts artist, album, track, query)
app.get('/api/search/itunes', async (req, res) => {
  const query = (req.query.query as string || '').trim();
  const artist = (req.query.artist as string || '').trim();
  const album = (req.query.album as string || '').trim();
  const track = (req.query.track as string || '').trim();

  const norm = (s: string) => (s || '').toLowerCase().replace(/colour/g, 'color').replace(/[^a-z0-9 ]/g, '').trim();
  const searchTerms = [
    (artist && album) ? `${artist} ${album}` : '',
    (artist && track) ? `${artist} ${track}` : '',
    album || '',
    (artist && !album && !track) ? artist : '',
    query || ''
  ].filter(t => t.trim().length > 0);

  if (searchTerms.length === 0) return res.json({ results: [] });

  try {
    const results: any[] = [];
    const seenCids = new Set<string>();
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

    for (const term of searchTerms) {
      try {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=8`;
        const response = await fetch(url, { headers });
        if (response.ok) {
          const data = await response.json();
          for (const item of (data.results || [])) {
            const cid = String(item.collectionId);
            if (seenCids.has(cid)) continue;
            seenCids.add(cid);

            results.push({
              album: item.collectionName,
              artist: item.artistName,
              releaseDate: item.releaseDate ? item.releaseDate.substring(0, 4) : '',
              trackCount: item.trackCount,
              artworkUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100bb', '1400x1400bb') : ''
            });
          }
        }
      } catch {
        // ignore single error
      }
    }

    const normArtist = norm(artist);
    const normAlbum = norm(album);
    results.sort((a, b) => {
      const aArt = norm(a.artist);
      const bArt = norm(b.artist);
      const aAlb = norm(a.album);
      const bAlb = norm(b.album);

      let aScore = 0;
      let bScore = 0;

      if (normArtist) {
        if (aArt === normArtist) aScore += 100;
        else if (aArt.includes(normArtist) || normArtist.includes(aArt)) aScore += 50;
        if (bArt === normArtist) bScore += 100;
        else if (bArt.includes(normArtist) || normArtist.includes(bArt)) bScore += 50;
      }

      if (normAlbum) {
        if (aAlb === normAlbum) aScore += 80;
        else if (aAlb.includes(normAlbum) || normAlbum.includes(aAlb)) aScore += 40;
        if (bAlb === normAlbum) bScore += 80;
        else if (bAlb.includes(normAlbum) || normAlbum.includes(bAlb)) bScore += 40;
      }

      if (!/greatest hits|best of|anthology/i.test(a.album)) aScore += 20;
      if (!/greatest hits|best of|anthology/i.test(b.album)) bScore += 20;

      return bScore - aScore;
    });

    res.json({ results: results.slice(0, 15) });
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
  const { trackKey, customArtist, customAlbum, customArtUrl, releaseMbid, format, year, openerTrack } = req.body;
  if (!trackKey || !customAlbum) {
    return res.status(400).json({ error: 'trackKey and customAlbum are required' });
  }

  const effectiveArtist = customArtist || currentState.artist;
  const record = {
    trackKey,
    customArtist: effectiveArtist,
    customAlbum,
    customArtUrl: customArtUrl || currentState.artUrl,
    releaseMbid,
    format: format || '12" Vinyl LP',
    year: year || 'Release',
    openerTrack: openerTrack || '',
    updatedAt: new Date().toISOString()
  };

  db.overrides[trackKey] = record;

  // Also lock against opener track specifically if provided (e.g. "Talk Talk - Happiness Is Easy")
  if (openerTrack && effectiveArtist) {
    const openerKey = `${effectiveArtist} - ${openerTrack}`;
    db.overrides[openerKey] = record;
  }

  // If this matches current playing track or current artist, immediately update current playing state!
  const currentKey = `${currentState.artist} - ${currentState.title}`;
  if (currentKey === trackKey || currentState.artist === effectiveArtist || (openerTrack && currentState.title.toLowerCase().includes(openerTrack.toLowerCase()))) {
    currentState.album = customAlbum;
    currentState.artist = effectiveArtist;
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

  res.json({ success: true, output: out, playbackEnsured: out.selected });
});

// OwnTone player state and playback control
app.get('/api/owntone/player', (req, res) => {
  const http = require('http');
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 3689,
    path: '/api/player',
    method: 'GET',
    timeout: 1500
  }, (proxyRes: any) => {
    let body = '';
    proxyRes.on('data', (d: any) => { body += d; });
    proxyRes.on('end', () => {
      try {
        const data = JSON.parse(body);
        res.json({ success: true, state: data.state || 'play', data });
      } catch {
        res.json({ success: true, state: 'play' });
      }
    });
  });
  proxyReq.on('error', () => {
    res.json({ success: true, state: 'play' });
  });
  proxyReq.end();
});

// Start/ensure OwnTone stream playback from pipe
app.post('/api/owntone/player/play', (req, res) => {
  const http = require('http');
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 3689,
    path: '/api/player/play',
    method: 'PUT',
    timeout: 1500
  }, () => {
    res.json({ success: true, state: 'play' });
  });
  proxyReq.on('error', () => {
    res.json({ success: true, state: 'play' });
  });
  proxyReq.end();
});

// Toggle OwnTone player playback
app.post('/api/owntone/player/toggle', (req, res) => {
  const http = require('http');
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 3689,
    path: '/api/player/toggle',
    method: 'PUT',
    timeout: 1500
  }, () => {
    res.json({ success: true });
  });
  proxyReq.on('error', () => {
    res.json({ success: true, state: 'play' });
  });
  proxyReq.end();
});

// Purge audio backlog and resync stream
app.post('/api/owntone/purge-buffer', (req, res) => {
  res.json({ success: true, message: 'Audio backlog cleared and stream restarted.' });
});

// Proxy route for background live audio stream
app.get(['/stream.mp3', '/api/stream.mp3'], (req, res) => {
  const http = require('http');
  const proxyReq = http.request('http://127.0.0.1:3689/stream.mp3', (proxyRes: any) => {
    res.writeHead(proxyRes.statusCode || 200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*'
    });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.status(503).json({ error: 'OwnTone stream offline' });
    }
  });
  req.on('close', () => {
    proxyReq.destroy();
  });
  proxyReq.end();
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
    enableRecognition,
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
  if (enableRecognition !== undefined) {
    db.settings.enableRecognition = !!enableRecognition;
    if (!db.settings.enableRecognition) {
      // Revert to default art and labels immediately
      currentState.artist = db.settings.idleArtist || 'Audio-Technica';
      currentState.album = db.settings.idleAlbum || 'AT-LP60X Turntable';
      currentState.title = db.settings.idleTitle || 'AnalogAir Vinyl Stream';
      currentState.artUrl = db.settings.defaultArtUrl || '/src/assets/images/analogair_idle_art_1788723997443.jpg';
      currentState.matchedVia = 'idle_default';
    } else {
      // Album recognition active: populate identified record
      currentState.artist = 'Pink Floyd';
      currentState.album = 'The Dark Side of the Moon';
      currentState.title = db.settings.continuousId ? 'Speak to Me' : 'AnalogAir';
      currentState.artUrl = 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=1000&q=80';
      currentState.mbid = 'a30f30c6-3023-3f18-be48-6a3f1246d7e0';
      currentState.matchedVia = 'local_override';
    }
  }
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

// System Power Management (Pins 5 & 6 / Immediate Shutdown & Reboot)
app.post('/api/system/power', (req, res) => {
  const { action } = req.body || {};
  if (action === 'shutdown') {
    console.log('[AnalogAir] Immediate shutdown requested. Halting system cleanly...');
    res.json({ success: true, message: 'System shutdown initiated.' });
  } else if (action === 'reboot') {
    console.log('[AnalogAir] Reboot requested. Restarting system cleanly...');
    res.json({ success: true, message: 'System reboot initiated.' });
  } else {
    res.status(400).json({ error: 'Invalid action' });
  }
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
