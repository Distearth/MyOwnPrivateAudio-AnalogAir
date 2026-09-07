import React, { useState, useEffect, useCallback } from 'react';
import { NowPlayingDisplay } from './components/NowPlayingDisplay';
import { ControlsOverlay } from './components/ControlsOverlay';
import { MetadataEditorModal } from './components/MetadataEditorModal';
import { ScreenDimmer } from './components/ScreenDimmer';
import {
  NowPlayingState,
  ToneControls,
  OwnToneOutput,
  PlaySession,
  SystemPreferences
} from './types';

const defaultState: NowPlayingState = {
  status: 'playing',
  artist: 'Pink Floyd',
  album: 'The Dark Side of the Moon',
  title: 'Speak to Me',
  artUrl: 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=1000&q=80',
  mbid: 'a30f30c6-3023-3f18-be48-6a3f1246d7e0',
  sourceType: 'vinyl',
  isContinuous: false,
  sideLocked: true,
  playCount: 4,
  rmsLevel: 0.18,
  sampleRate: 44100,
  bitDepth: 16,
  inputDeviceName: 'USB Audio CODEC (Turntable Preamp USB)',
  matchedVia: 'local_override'
};

const defaultTone: ToneControls = {
  inputGainDb: 0,
  bassGainDb: 1.5,
  midGainDb: 0,
  trebleGainDb: 0.5,
  selectedDeviceId: 'usb_audio_codec_0',
  deviceList: []
};

const defaultSettings: SystemPreferences = {
  sourceType: 'vinyl',
  customStreamLabel: 'Vinyl Audio Streaming',
  defaultArtUrl: '/assets/default_vinyl.jpg',
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
};

async function safeJsonFetch<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return null;
  } catch {
    return null;
  }
}

export default function App() {
  const [state, setState] = useState<NowPlayingState>(defaultState);
  const [tone, setTone] = useState<ToneControls>(defaultTone);
  const [outputs, setOutputs] = useState<OwnToneOutput[]>([]);
  const [sessions, setSessions] = useState<PlaySession[]>([]);
  const [settings, setSettings] = useState<SystemPreferences>(defaultSettings);

  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isMetadataEditorOpen, setIsMetadataEditorOpen] = useState(false);
  const [lastActivityTimestamp, setLastActivityTimestamp] = useState<number>(Date.now());

  // Track user interaction to reset OLED burn-in dimmer timer
  const recordActivity = useCallback(() => {
    setLastActivityTimestamp(Date.now());
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', recordActivity);
    window.addEventListener('mousedown', recordActivity);
    window.addEventListener('touchstart', recordActivity);
    window.addEventListener('keydown', recordActivity);

    return () => {
      window.removeEventListener('mousemove', recordActivity);
      window.removeEventListener('mousedown', recordActivity);
      window.removeEventListener('touchstart', recordActivity);
      window.removeEventListener('keydown', recordActivity);
    };
  }, [recordActivity]);

  // Fetch full status
  const fetchState = useCallback(async () => {
    const data = await safeJsonFetch<any>('/api/state');
    if (!data) return;

    setState({
      status: data.status || defaultState.status,
      artist: data.artist || defaultState.artist,
      album: data.album || defaultState.album,
      title: data.title || defaultState.title,
      artUrl: data.artUrl || defaultState.artUrl,
      mbid: data.mbid,
      sourceType: data.sourceType || 'vinyl',
      isContinuous: data.isContinuous ?? defaultState.isContinuous,
      sideLocked: data.sideLocked ?? defaultState.sideLocked,
      playCount: data.playCount,
      rmsLevel: data.rmsLevel ?? defaultState.rmsLevel,
      sampleRate: data.sampleRate ?? defaultState.sampleRate,
      bitDepth: data.bitDepth ?? defaultState.bitDepth,
      inputDeviceName: data.inputDeviceName || defaultState.inputDeviceName,
      matchedVia: data.matchedVia || defaultState.matchedVia,
      startedAt: data.startedAt || defaultState.startedAt
    });
    if (data.tone) {
      setTone(prev => ({ ...prev, ...data.tone }));
    }
    if (data.settings) {
      setSettings(prev => ({ ...prev, ...data.settings }));
    }
  }, []);

  const fetchToneAndDevices = useCallback(async () => {
    const data = await safeJsonFetch<ToneControls>('/api/tone');
    if (data) {
      setTone(prev => ({ ...prev, ...data }));
    }
  }, []);

  const fetchOutputs = useCallback(async () => {
    const data = await safeJsonFetch<{ outputs?: OwnToneOutput[]; favoriteSpeakers?: string[] }>('/api/owntone/outputs');
    if (data?.outputs) {
      const storedFavs: string[] = (() => {
        try {
          const raw = localStorage.getItem('analogair_favorite_speakers');
          return raw ? JSON.parse(raw).map(String) : [];
        } catch {
          return [];
        }
      })();

      const serverFavs = Array.isArray(data.favoriteSpeakers) ? data.favoriteSpeakers.map(String) : null;
      if (serverFavs) {
        try {
          localStorage.setItem('analogair_favorite_speakers', JSON.stringify(serverFavs));
        } catch {}
      }

      const activeFavs = serverFavs || storedFavs;

      setOutputs(data.outputs.map(o => {
        const sId = String(o.id);
        return {
          ...o,
          id: sId,
          isFavorite: activeFavs.includes(sId) || Boolean(o.isFavorite)
        };
      }));
    }
  }, []);

  const fetchSessions = useCallback(async () => {
    const data = await safeJsonFetch<{ sessions?: PlaySession[] }>('/api/sessions');
    if (data?.sessions) {
      setSessions(data.sessions);
    }
  }, []);

  // Polling loop
  useEffect(() => {
    fetchState();
    fetchToneAndDevices();
    fetchOutputs();
    fetchSessions();

    const interval = setInterval(() => {
      fetchState();
      fetchOutputs();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchState, fetchToneAndDevices, fetchOutputs, fetchSessions]);

  // Update tone controls
  const handleUpdateTone = async (newTone: Partial<ToneControls>) => {
    setTone(prev => ({ ...prev, ...newTone }));
    await safeJsonFetch('/api/tone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTone)
    });
  };

  // Toggle OwnTone speaker (Enforces 100% volume by default)
  const handleToggleOutput = async (id: string) => {
    setOutputs(prev => prev.map(o => {
      if (o.id === id) {
        const willSelect = !o.selected;
        return {
          ...o,
          selected: willSelect,
          volume: willSelect ? 100 : o.volume
        };
      }
      return o;
    }));

    const data = await safeJsonFetch<{ output?: OwnToneOutput }>(`/api/owntone/outputs/${id}/toggle`, { method: 'POST' });
    if (data?.output) {
      setOutputs(prev => prev.map(o => o.id === id ? { ...o, ...data.output } : o));
    }
  };

  const handleUpdateOutputVolume = async (id: string, vol: number) => {
    setOutputs(prev => prev.map(o => o.id === id ? { ...o, volume: vol } : o));
    await safeJsonFetch(`/api/owntone/outputs/${id}/volume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume: vol })
    });
  };

  const handleToggleFavoriteOutput = async (id: string) => {
    const stringId = String(id);
    setOutputs(prev => {
      const updated = prev.map(o => String(o.id) === stringId ? { ...o, isFavorite: !o.isFavorite } : o);
      try {
        const favIds = updated.filter(o => o.isFavorite).map(o => String(o.id));
        localStorage.setItem('analogair_favorite_speakers', JSON.stringify(favIds));
      } catch {
        // ignore storage errors
      }
      return updated;
    });
    const res = await safeJsonFetch<{ success?: boolean; isFavorite?: boolean; favoriteSpeakers?: string[] }>(
      `/api/owntone/outputs/${stringId}/favorite`,
      { method: 'POST' }
    );
    if (res?.favoriteSpeakers && Array.isArray(res.favoriteSpeakers)) {
      const serverFavs = res.favoriteSpeakers.map(String);
      try {
        localStorage.setItem('analogair_favorite_speakers', JSON.stringify(serverFavs));
      } catch {}
      setOutputs(prev => prev.map(o => ({
        ...o,
        isFavorite: serverFavs.includes(String(o.id))
      })));
    }
  };

  const handleToggleMode = async (continuous: boolean) => {
    setState(prev => ({ ...prev, isContinuous: continuous }));
    await safeJsonFetch('/api/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ continuous })
    });
  };

  const handleSimulateNeedleDrop = async () => {
    const data = await safeJsonFetch<{ state?: NowPlayingState }>('/api/simulate/needle-drop', { method: 'POST' });
    if (data?.state) {
      setState(data.state);
      fetchSessions();
    }
  };

  const handleSimulateSilence = async () => {
    const data = await safeJsonFetch<{ state?: NowPlayingState }>('/api/simulate/silence', { method: 'POST' });
    if (data?.state) {
      setState(data.state);
    }
  };

  const handleUpdateSettings = async (newSettings: Partial<SystemPreferences>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
    await safeJsonFetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    fetchState();
  };

  const handleDeleteSession = async (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    await safeJsonFetch(`/api/sessions/${id}`, { method: 'DELETE' });
  };

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans text-neutral-100">
      {/* 1. Fullscreen Touchscreen Now Playing View */}
      <NowPlayingDisplay
        state={state}
        settings={settings}
        onOpenControls={() => setIsControlsOpen(true)}
        onOpenEditMetadata={() => setIsMetadataEditorOpen(true)}
      />

      {/* 2. Slide-up Touchscreen Controls Overlay */}
      <ControlsOverlay
        isOpen={isControlsOpen}
        onClose={() => setIsControlsOpen(false)}
        state={state}
        tone={tone}
        outputs={outputs}
        sessions={sessions}
        settings={settings}
        onUpdateTone={handleUpdateTone}
        onToggleOutput={handleToggleOutput}
        onUpdateOutputVolume={handleUpdateOutputVolume}
        onToggleFavoriteOutput={handleToggleFavoriteOutput}
        onToggleMode={handleToggleMode}
        onOpenEditMetadata={() => setIsMetadataEditorOpen(true)}
        onSimulateNeedleDrop={handleSimulateNeedleDrop}
        onSimulateSilence={handleSimulateSilence}
        onUpdateSettings={handleUpdateSettings}
        onDeleteSession={handleDeleteSession}
      />

      {/* 3. Metadata & Cover Art Override Modal */}
      <MetadataEditorModal
        isOpen={isMetadataEditorOpen}
        onClose={() => setIsMetadataEditorOpen(false)}
        currentArtist={state.artist}
        currentAlbum={state.album}
        currentTitle={state.title}
        currentArtUrl={state.artUrl}
        currentMbid={state.mbid}
        onSaved={() => {
          fetchState();
          fetchSessions();
        }}
      />

      {/* 4. OLED / Touchscreen Burn-in Protection Dimmer */}
      <ScreenDimmer
        dimMinutes={settings.dimMinutes}
        lastActivityTimestamp={lastActivityTimestamp}
        currentTrackKey={`${state.artist} - ${state.album}`}
        onWake={recordActivity}
      />
    </div>
  );
}
