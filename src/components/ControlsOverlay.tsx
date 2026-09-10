import React, { useState, useRef } from 'react';
import { sanitizeAlbumTitle, sanitizeTrackTitle } from '../utils/sanitize';
import { copyToClipboard } from '../utils/clipboard';
import {
  X,
  Sliders,
  Volume2,
  Disc,
  History,
  Terminal,
  Settings,
  Sparkles,
  Music,
  Lock,
  Unlock,
  Play,
  RotateCcw,
  Star,
  Download,
  Copy,
  Check,
  ExternalLink,
  Info,
  Radio,
  Cast,
  Cpu,
  Trash2,
  CassetteTape,
  Disc3,
  FileCode,
  Share2,
  Upload,
  Image as ImageIcon,
  FileUp,
  AlertCircle,
  RefreshCw,
  Monitor,
  HardDrive,
  Power
} from 'lucide-react';
import {
  NowPlayingState,
  ToneControls,
  OwnToneOutput,
  PlaySession,
  SystemPreferences,
  ReleaseOverride
} from '../types';
import { ToneVisualizer } from './ToneVisualizer';
import { ErrorBoundary } from './ErrorBoundary';

interface ControlsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  state: NowPlayingState;
  tone: ToneControls;
  outputs: OwnToneOutput[];
  sessions: PlaySession[];
  settings: SystemPreferences;
  onUpdateTone: (newTone: Partial<ToneControls>, immediate?: boolean) => void;
  onToggleOutput: (id: string) => void;
  onUpdateOutputVolume: (id: string, vol: number) => void;
  onToggleFavoriteOutput: (id: string) => void;
  onToggleMode: (continuous: boolean) => void;
  onOpenEditMetadata: () => void;
  onUpdateSettings: (newSettings: Partial<SystemPreferences>) => void;
  onDeleteSession: (id: string) => void;
}

export const ControlsOverlay: React.FC<ControlsOverlayProps> = ({
  isOpen,
  onClose,
  state,
  tone,
  outputs,
  sessions,
  settings,
  onUpdateTone,
  onToggleOutput,
  onUpdateOutputVolume,
  onToggleFavoriteOutput,
  onToggleMode,
  onOpenEditMetadata,
  onUpdateSettings,
  onDeleteSession
}) => {
  const [activeTab, setActiveTab] = useState<'quick' | 'tone' | 'speakers' | 'history' | 'update' | 'settings'>('quick');
  const [copiedCmdId, setCopiedCmdId] = useState<string | null>(null);
  const [isUploadingArt, setIsUploadingArt] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingArt, setIsDraggingArt] = useState(false);
  const [powerActionStatus, setPowerActionStatus] = useState<string | null>(null);
  const [showPowerConfirm, setShowPowerConfirm] = useState<'shutdown' | 'reboot' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTriggerPower = async (action: 'shutdown' | 'reboot') => {
    try {
      setShowPowerConfirm(null);
      setPowerActionStatus(action === 'shutdown' ? 'Shutting down system immediately...' : 'Restarting system cleanly...');
      await fetch('/api/system/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
    } catch {
      // Disconnection expected as Pi shuts down or restarts
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file (JPG, PNG, WebP).');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setUploadError('Image size exceeds 25MB limit.');
      return;
    }

    setIsUploadingArt(true);
    setUploadError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageBase64 = e.target?.result as string;
        if (!imageBase64) {
          setUploadError('Failed to read photo data.');
          setIsUploadingArt(false);
          return;
        }

        try {
          const res = await fetch('/api/upload/default-art', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64 })
          });
          const data = await res.json();
          if (data.success && data.artUrl) {
            onUpdateSettings({ defaultArtUrl: data.artUrl });
            setUploadError(null);
          } else {
            setUploadError(data.error || 'Failed to upload photo.');
          }
        } catch (err: any) {
          setUploadError('Error uploading image: ' + err.message);
        } finally {
          setIsUploadingArt(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setUploadError('Error reading file: ' + err.message);
      setIsUploadingArt(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingArt(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingArt(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingArt(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  if (!isOpen) return null;

  const copyCommand = async (text: string, id: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedCmdId(id);
      setTimeout(() => setCopiedCmdId(null), 2000);
    }
  };

  // Sort speakers with favorites on top
  const sortedOutputs = [...outputs].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-neutral-900 border-t sm:border border-neutral-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] h-[92vh] sm:h-[85vh]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-100 flex items-center gap-2">
                <span>AnalogAir Control Console</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 font-mono">
                  v1.2 Trixie
                </span>
              </h2>
              <p className="text-xs text-neutral-400">
                {state.album} • {state.artist}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex px-4 border-b border-neutral-800 bg-neutral-950/40 text-xs font-semibold overflow-x-auto whitespace-nowrap">
          <button
            onClick={() => setActiveTab('quick')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'quick' ? 'border-amber-500 text-amber-400 bg-amber-500/5' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Disc className="w-4 h-4" />
            <span>Now Playing</span>
          </button>
          <button
            onClick={() => setActiveTab('tone')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'tone' ? 'border-amber-500 text-amber-400 bg-amber-500/5' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Tone & Gain (DSP)</span>
          </button>
          <button
            onClick={() => setActiveTab('speakers')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'speakers' ? 'border-amber-500 text-amber-400 bg-amber-500/5' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            <span>Speakers ({outputs.filter(o => o.selected).length})</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'history' ? 'border-amber-500 text-amber-400 bg-amber-500/5' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Played Albums ({sessions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('update')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'update' ? 'border-amber-500 text-amber-400 bg-amber-500/5' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <RefreshCw className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-400">Update AnalogAir</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'settings' ? 'border-amber-500 text-amber-400 bg-amber-500/5' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Preferences</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <ErrorBoundary fallbackTitle="Controls View Error">
          {/* TAB 1: QUICK ACTIONS & NOW PLAYING */}
          {activeTab === 'quick' && (
            <div className="space-y-6">
              {/* No Recognition / Album Identification Mode Control (Above Now Playing Box) */}
              <div className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                !settings.enableRecognition
                  ? 'bg-neutral-950/90 border-amber-500/40 ring-1 ring-amber-500/20 shadow-lg'
                  : 'bg-emerald-950/20 border-emerald-500/30 ring-1 ring-emerald-500/10 shadow-sm'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 ${
                      !settings.enableRecognition
                        ? 'bg-neutral-900 border border-neutral-800 text-amber-400'
                        : 'bg-emerald-900/40 border border-emerald-700/50 text-emerald-400'
                    }`}>
                      {!settings.enableRecognition ? (
                        <Radio className="w-5 h-5" />
                      ) : (
                        <Sparkles className="w-5 h-5" />
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-white">
                          {!settings.enableRecognition
                            ? 'Album Identification: Off (Resource Saver Mode)'
                            : 'Album Identification: Active (Shazam & MusicBrainz)'}
                        </h4>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                          !settings.enableRecognition
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        }`}>
                          {!settings.enableRecognition ? 'DEFAULT • ZERO CPU OVERHEAD' : 'LIVE FINGERPRINTING'}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 leading-relaxed">
                        {!settings.enableRecognition
                          ? 'Music streams with default art and info. Acoustic Shazam lookups are bypassed to conserve CPU and RAM on low-power Raspberry Pis. No history is logged to Played Albums.'
                          : 'Acoustic fingerprinting is active. Needle drops are submitted to Shazam & MusicBrainz to identify titles, fetch album art, and record spins to Played Albums.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                    {!settings.enableRecognition ? (
                      <button
                        onClick={() => onUpdateSettings({ enableRecognition: true })}
                        className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl flex items-center gap-2 transition-all shadow-md active:scale-95 whitespace-nowrap"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>Enable Album Identification</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onUpdateSettings({ enableRecognition: false })}
                        className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white font-medium text-xs rounded-xl border border-neutral-700 flex items-center gap-2 transition-all active:scale-95 whitespace-nowrap"
                      >
                        <Radio className="w-3.5 h-3.5 text-amber-400" />
                        <span>Switch to Resource Saver</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata Quick Overview Card */}
              <div className="p-5 bg-neutral-950/70 border border-neutral-800 rounded-2xl flex flex-col sm:flex-row gap-5 items-center justify-between">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 flex-shrink-0 shadow-md">
                    <img
                      src={state.artUrl || '/assets/default_idle.jpg'}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded font-mono bg-neutral-800 text-amber-400 border border-neutral-700">
                        {state.status === 'idle' ? 'STANDBY' : 'STREAMING'}
                      </span>
                      {!settings.enableRecognition ? (
                        <span className="text-xs px-2 py-0.5 rounded font-mono bg-neutral-800 text-neutral-400 border border-neutral-700">
                          No Recognition
                        </span>
                      ) : state.matchedVia === 'local_override' ? (
                        <span className="text-xs px-2 py-0.5 rounded font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                          Custom Saved
                        </span>
                      ) : null}
                    </div>
                    <h3 className="text-lg font-bold text-white leading-snug">{sanitizeAlbumTitle(state.album)}</h3>
                    <p className="text-sm text-neutral-400">{state.artist}</p>
                    {state.title && (
                      <p className="text-xs text-neutral-500 font-mono">Current Track: {sanitizeTrackTitle(state.title)}</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full sm:w-auto">
                  <button
                    onClick={onOpenEditMetadata}
                    className="flex-1 sm:flex-none px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Edit Metadata / Fix Art</span>
                  </button>
                </div>
              </div>

              {/* Recognition Mode Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
                  <span className="font-semibold uppercase tracking-wider text-[11px] text-neutral-400">
                    Identification Strategy
                  </span>
                  {!settings.enableRecognition && (
                    <span className="text-[11px] text-amber-400 font-mono">
                      (Applies when Album Identification is enabled)
                    </span>
                  )}
                </div>

                <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${!settings.enableRecognition ? 'opacity-60' : ''}`}>
                  <div
                    onClick={() => onToggleMode(false)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                      !state.isContinuous
                        ? 'bg-amber-500/10 border-amber-500/40 shadow-inner'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-neutral-200 font-bold text-sm">
                        <Lock className="w-4 h-4 text-amber-400" />
                        <span>Vinyl Side Lock (Recommended)</span>
                      </div>
                      {!state.isContinuous && (
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      Locks the detected Album Title and Artwork for the entire ~20 minute LP side. Eliminates flickering or misrecognitions between tracks.
                    </p>
                  </div>

                  <div
                    onClick={() => onToggleMode(true)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                      state.isContinuous
                        ? 'bg-sky-500/10 border-sky-500/40 shadow-inner'
                        : 'bg-neutral-950/60 border-neutral-800/80 hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-neutral-200 font-bold text-sm">
                        <Music className="w-4 h-4 text-sky-400" />
                        <span>Continuous Song-by-Song ID</span>
                      </div>
                      {state.isContinuous && (
                        <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      Continuously listens and identifies individual song titles as the needle advances across track boundaries. Displays real-time song title on screen.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TONE & GAIN CONTROLS (PIPEWIRE DSP) */}
          {activeTab === 'tone' && (
            <ErrorBoundary fallbackTitle="Tone & Equalizer Controls Error">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-neutral-100">Audio Preamp & Tone Equalizer</h3>
                    <p className="text-xs text-neutral-400">
                      Processed in real-time via PipeWire filter-chain before injecting into OwnTone.
                    </p>
                  </div>
                  <button
                    onClick={() => onUpdateTone({ inputGainDb: 0, bassGainDb: 0, midGainDb: 0, trebleGainDb: 0 }, true)}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 transition-colors"
                  >
                    Reset Flat (0 dB)
                  </button>
                </div>

                {/* Real-time Visualizer */}
                <ToneVisualizer
                  bassDb={tone?.bassGainDb ?? 1.5}
                  midDb={tone?.midGainDb ?? 0}
                  trebleDb={tone?.trebleGainDb ?? 0.5}
                  gainDb={tone?.inputGainDb ?? 0}
                />

                {/* Capture Device Selector */}
                <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-2">
                  <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                    Active USB Audio Capture Interface
                  </label>
                  <select
                    value={tone?.selectedDeviceId || 'default'}
                    onChange={(e) => onUpdateTone({ selectedDeviceId: e.target.value }, true)}
                    className="w-full p-2.5 bg-neutral-900 border border-neutral-700 rounded-xl text-neutral-100 text-sm focus:outline-none focus:border-amber-500"
                  >
                    {Array.isArray(tone?.deviceList) && tone.deviceList.length > 0 ? (
                      tone.deviceList.map((dev: any, idx: number) => {
                        const id = typeof dev === 'string' ? dev : (dev?.id || `dev_${idx}`);
                        const name = typeof dev === 'string' ? dev : (dev?.name || `Audio Device ${idx + 1}`);
                        const rates = Array.isArray(dev?.supportedRates) && dev.supportedRates.length > 0
                          ? `(${dev.supportedRates.join('/')} Hz)`
                          : '';
                        return (
                          <option key={id} value={id}>
                            {name} {rates}
                          </option>
                        );
                      })
                    ) : (
                      <option value="default">Default System Audio (PipeWire Auto-Select)</option>
                    )}
                  </select>
                  <p className="text-[11px] text-neutral-500">
                    PipeWire automatically converts fixed 16/48000 or multi-rate 24/96000 inputs to pristine 16/44100 without clock drift. The maximum audio resolution AirPlay supports is 16-bit / 44.1 kHz, so this sample rate conversion is required for streaming.
                  </p>
                </div>

                {/* EQ Reconnect & Buffering Notice */}
                <div className="p-4 bg-amber-950/20 border border-amber-800/40 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider">
                    <Info className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Real-Time Tone Adjustment Notice</span>
                  </div>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    When adjusting tone or preamp gain, audio drops out for ~1 second while the audio pipe connection is seamlessly re-established. Because of AirPlay network buffering (typically 2–3 seconds), it may take a few seconds for the change to be heard on your speakers.
                  </p>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    <strong className="text-neutral-200">Gain Calibration Guide:</strong> Listen to your speakers during loud vinyl passages. If you hear harsh digital clipping or crackling, reduce the <strong className="text-amber-400">Input Preamp</strong>. If playback volume is noticeably quiet compared to other AirPlay sources, increase the gain.
                  </p>
                </div>

                {/* Sliders Grid: 4-Band DSP Equalizer */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Input Preamp Gain */}
                  <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center text-sm font-semibold">
                      <span className="text-neutral-300">Input Preamp</span>
                      <span className="font-mono text-amber-400">
                        {(tone?.inputGainDb ?? 0) > 0 ? `+${tone?.inputGainDb}` : (tone?.inputGainDb ?? 0)} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={tone?.inputGainDb ?? 0}
                      onChange={(e) => onUpdateTone({ inputGainDb: parseFloat(e.target.value) || 0 })}
                      className="w-full accent-amber-500"
                    />
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      Listen for clipping or low volume: reduce if audio distorts on loud peaks; increase if too quiet.
                    </p>
                  </div>

                  {/* Bass Shelf (100 Hz) */}
                  <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center text-sm font-semibold">
                      <span className="text-neutral-300">Bass (100 Hz)</span>
                      <span className="font-mono text-amber-400">
                        {(tone?.bassGainDb ?? 0) > 0 ? `+${tone?.bassGainDb}` : (tone?.bassGainDb ?? 0)} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={tone?.bassGainDb ?? 0}
                      onChange={(e) => onUpdateTone({ bassGainDb: parseFloat(e.target.value) || 0 })}
                      className="w-full accent-amber-500"
                    />
                    <p className="text-[11px] text-neutral-500">
                      Low-end punch and warmth for thin vinyl pressings.
                    </p>
                  </div>

                  {/* Mid Peaking (1 kHz) */}
                  <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center text-sm font-semibold">
                      <span className="text-neutral-300">Mid (1 kHz)</span>
                      <span className="font-mono text-emerald-400">
                        {(tone?.midGainDb ?? 0) > 0 ? `+${tone?.midGainDb}` : (tone?.midGainDb ?? 0)} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={tone?.midGainDb ?? 0}
                      onChange={(e) => onUpdateTone({ midGainDb: parseFloat(e.target.value) || 0 })}
                      className="w-full accent-emerald-500"
                    />
                    <p className="text-[11px] text-neutral-500">
                      Vocal presence, midrange clarity, and instrument body.
                    </p>
                  </div>

                  {/* Treble Shelf (10 kHz) */}
                  <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center text-sm font-semibold">
                      <span className="text-neutral-300">Treble (10 kHz)</span>
                      <span className="font-mono text-sky-400">
                        {(tone?.trebleGainDb ?? 0) > 0 ? `+${tone?.trebleGainDb}` : (tone?.trebleGainDb ?? 0)} dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="0.5"
                      value={tone?.trebleGainDb ?? 0}
                      onChange={(e) => onUpdateTone({ trebleGainDb: parseFloat(e.target.value) || 0 })}
                      className="w-full accent-sky-500"
                    />
                    <p className="text-[11px] text-neutral-500">
                      High-frequency sparkle or softening record surface hiss.
                    </p>
                  </div>
                </div>
              </div>
            </ErrorBoundary>
          )}

          {/* TAB 3: OWNTONE SPEAKERS */}
          {activeTab === 'speakers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-neutral-100">AirPlay & Speaker Outputs</h3>
                  <p className="text-xs text-neutral-400">
                    Selecting any destination sets volume to 100% and automatically resumes stream playback from the vinyl pipe.
                  </p>
                </div>
                <a
                  href={`http://${window.location.hostname}:3689/#/outputs`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 transition-colors flex items-center gap-1.5"
                >
                  <span>Open OwnTone Web</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sortedOutputs.map((out) => {
                  return (
                    <div
                      key={out.id}
                      className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                        out.selected
                          ? 'bg-neutral-900 border-amber-500/50 shadow-lg'
                          : 'bg-neutral-950/60 border-neutral-800/80 opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl border ${
                            out.selected 
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                              : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          }`}>
                            {out.type === 'airplay' && <Radio className="w-5 h-5" />}
                            {out.type === 'chromecast' && <Cast className="w-5 h-5" />}
                            {out.type === 'bluetooth' && <Volume2 className="w-5 h-5" />}
                            {out.type === 'local' && <Cpu className="w-5 h-5" />}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-neutral-100 flex items-center gap-1.5 flex-wrap">
                              <span>{out.name}</span>
                              {out.isFavorite && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                  <Star className="w-2.5 h-2.5 fill-amber-400" />
                                  Auto-Connects on Boot
                                </span>
                              )}
                            </h4>
                            <span className="text-[11px] text-neutral-500 uppercase font-mono tracking-wider">
                              {out.type}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => onToggleFavoriteOutput(out.id)}
                            title={out.isFavorite ? "Remove from startup auto-connect" : "Always connect to this speaker on boot"}
                            className={`px-2.5 py-1.5 rounded-xl border transition-colors flex items-center gap-1.5 text-xs ${
                              out.isFavorite 
                                ? 'text-amber-300 bg-amber-500/15 border-amber-500/30 hover:bg-amber-500/25' 
                                : 'text-neutral-400 bg-neutral-800/60 border-neutral-700 hover:text-neutral-200'
                            }`}
                          >
                            <Star className={`w-3.5 h-3.5 ${out.isFavorite ? 'text-amber-400 fill-amber-400' : ''}`} />
                            <span className="hidden sm:inline text-[11px] font-medium">
                              {out.isFavorite ? 'Auto-Connect: On' : 'Auto-Connect: Off'}
                            </span>
                          </button>
                          <button
                            onClick={() => onToggleOutput(out.id)}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-colors ${
                              out.selected
                                ? 'bg-amber-500 text-neutral-950 hover:bg-amber-400'
                                : 'bg-neutral-800 text-neutral-400 hover:text-white'
                            }`}
                          >
                            {out.selected ? 'Playing (100%)' : 'Turn On'}
                          </button>
                        </div>
                      </div>

                      {/* Volume Slider (Defaults to 100% when turned on) */}
                      {out.selected && (
                        <div className="pt-2 border-t border-neutral-800/80 flex items-center gap-3">
                          <Volume2 className="w-4 h-4 text-neutral-400" />
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={out.volume}
                            onChange={(e) => onUpdateOutputVolume(out.id, parseInt(e.target.value, 10))}
                            className="flex-1"
                          />
                          <span className="text-xs font-mono text-neutral-400 w-10 text-right">
                            {out.volume}%
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: PLAYED ALBUMS HISTORY */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-neutral-100">Played Albums Log</h3>
                  <p className="text-xs text-neutral-400">
                    Sessions logged by AnalogAir. Tap any album to inspect or update saved vinyl overrides.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {sessions.length === 0 ? (
                  <div className="text-center py-10 text-neutral-500 text-sm">
                    No vinyl albums logged yet. Drop a needle to start recording play history!
                  </div>
                ) : (
                  sessions.map((sess) => (
                    <div
                      key={sess.id}
                      className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-xl flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-neutral-900 overflow-hidden border border-neutral-800 flex-shrink-0">
                          <img src={sess.artUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-neutral-200">{sess.album}</span>
                            {sess.hasOverride && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                                Overridden
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-neutral-400">{sess.artist} • Opener: {sess.firstTrack}</p>
                          <p className="text-[10px] text-neutral-500 font-mono">
                            Plays: {sess.playCount} • Last: {new Date(sess.playedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            onOpenEditMetadata();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-300 transition-colors"
                        >
                          Edit Info
                        </button>
                        <button
                          onClick={() => onDeleteSession(sess.id)}
                          title="Delete Session"
                          className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: UPDATE ANALOGAIR & SYSTEM BOOT GUIDE */}
          {activeTab === 'update' && (
            <div className="space-y-6 text-sm leading-relaxed">
              {/* Header Overview Card */}
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                <div className="flex items-center gap-2 font-bold text-emerald-300 text-base mb-1">
                  <RefreshCw className="w-5 h-5 text-emerald-400" />
                  <h3>Update AnalogAir to Latest GitHub Version</h3>
                </div>
                <p className="text-xs text-neutral-300">
                  Update your Raspberry Pi installation with safe background service management. Services are paused before updating to prevent file locks or audio pipe collisions, then automatically restarted with the new code.
                </p>
              </div>

              {/* Critical Notice: Why Services Must Be Stopped */}
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-300 text-xs">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span>Why Stop Services Before Updating?</span>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  AnalogAir runs three continuous background user services: <code className="text-amber-200 font-mono">analogair-capture</code> (reading your turntable USB hardware), <code className="text-amber-200 font-mono">analogair-daemon</code> (running acoustic recognition), and <code className="text-amber-200 font-mono">analogair-web</code> (serving this web interface). Stopping them ensures that Python files, virtualenv libraries, and the audio FIFO pipe are not locked during git updates.
                </p>
              </div>

              {/* Method 1: 1-Command Automated Updater (Recommended) */}
              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-3">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Method 1: One-Line Automated Update (Recommended)
                  </span>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Runs the automated updater script: stops services &rarr; pulls latest git commits &rarr; refreshes python dependencies & UI &rarr; restarts services.
                  </p>
                </div>

                <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between font-mono text-xs text-amber-300">
                  <span className="truncate mr-2 select-all cursor-text" title="Click to select all">
                    cd ~/MyOwnPrivateAudio-AnalogAir && bash ./update.sh
                  </span>
                  <button
                    onClick={() => copyCommand('cd ~/MyOwnPrivateAudio-AnalogAir && bash ./update.sh', 'quick-update')}
                    className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors flex-shrink-0"
                    title="Copy Command"
                  >
                    {copiedCmdId === 'quick-update' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                <p className="text-xs text-neutral-500">
                  Or run with one direct chained command if preferred:
                </p>
                <div className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl flex items-center justify-between font-mono text-xs text-neutral-300">
                  <span className="truncate mr-2 text-[11px] select-all cursor-text" title="Click to select all">
                    systemctl --user stop analogair-capture analogair-daemon analogair-web && cd ~/MyOwnPrivateAudio-AnalogAir && git pull origin main && ./install.sh && systemctl --user restart analogair-capture analogair-daemon analogair-web
                  </span>
                  <button
                    onClick={() => copyCommand('systemctl --user stop analogair-capture analogair-daemon analogair-web && cd ~/MyOwnPrivateAudio-AnalogAir && git pull origin main && ./install.sh && systemctl --user restart analogair-capture analogair-daemon analogair-web', 'full-pipe-update')}
                    className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors flex-shrink-0"
                    title="Copy Full Command"
                  >
                    {copiedCmdId === 'full-pipe-update' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Method 2: Step-by-Step Manual Update */}
              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                    Method 2: Step-by-Step Manual Update Process
                  </span>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    For manual control, terminal inspection, or step-by-step verification.
                  </p>
                </div>

                <div className="space-y-3">
                  {/* Step 1 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center text-[10px] font-bold">1</span>
                        Stop Active AnalogAir Background Services
                      </span>
                      <button
                        onClick={() => copyCommand('systemctl --user stop analogair-capture analogair-daemon analogair-web', 'step-1')}
                        className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedCmdId === 'step-1' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl font-mono text-xs text-amber-300 overflow-x-auto">
                      systemctl --user stop analogair-capture analogair-daemon analogair-web
                    </pre>
                  </div>

                  {/* Step 2 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center text-[10px] font-bold">2</span>
                        Pull Latest Commits from GitHub
                      </span>
                      <button
                        onClick={() => copyCommand('cd ~/MyOwnPrivateAudio-AnalogAir && git pull origin main', 'step-2')}
                        className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedCmdId === 'step-2' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl font-mono text-xs text-amber-300 overflow-x-auto">
                      cd ~/MyOwnPrivateAudio-AnalogAir && git pull origin main
                    </pre>
                  </div>

                  {/* Step 3 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center text-[10px] font-bold">3</span>
                        Sync Scripts & Update Virtual Environment
                      </span>
                      <button
                        onClick={() => copyCommand('chmod +x ./install.sh && ./install.sh', 'step-3')}
                        className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedCmdId === 'step-3' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl font-mono text-xs text-amber-300 overflow-x-auto">
                      chmod +x ./install.sh && ./install.sh
                    </pre>
                  </div>

                  {/* Step 4 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center text-[10px] font-bold">4</span>
                        Reload Systemd & Restart Background Services
                      </span>
                      <button
                        onClick={() => copyCommand('systemctl --user daemon-reload && systemctl --user restart analogair-capture analogair-daemon analogair-web', 'step-4')}
                        className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedCmdId === 'step-4' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl font-mono text-xs text-amber-300 overflow-x-auto">
                      systemctl --user daemon-reload && systemctl --user restart analogair-capture analogair-daemon analogair-web
                    </pre>
                  </div>

                  {/* Step 5 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-neutral-800 text-neutral-300 flex items-center justify-center text-[10px] font-bold">5</span>
                        Verify Service Status & Health
                      </span>
                      <button
                        onClick={() => copyCommand('systemctl --user status analogair-web.service --no-pager', 'step-5')}
                        className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedCmdId === 'step-5' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Copy</span>
                      </button>
                    </div>
                    <pre className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl font-mono text-xs text-amber-300 overflow-x-auto select-all cursor-text">
                      systemctl --user status analogair-web.service --no-pager
                    </pre>
                  </div>
                </div>
              </div>

              {/* Hardware Power Switch (Physical Pins 5 & 6) & System Shutdown */}
              <div className="p-5 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-neutral-100 text-sm">
                      <Power className="w-4 h-4 text-rose-400" />
                      <span>Hardware Power Switch & System Shutdown</span>
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-950/60 text-rose-300 border border-rose-800/50 rounded-full">
                        Pins 5 & 6 (GPIO 3 + GND)
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                      Instant operating system shutdown via dedicated Howchoo background listener (Pins 5 & 6) — cleanly powering down the Pi when shorted without triggering desktop GUI prompts or breaking your desktop logout menu. When powered off, shorting the same pins wakes and boots your Raspberry Pi.
                    </p>
                  </div>
                </div>

                {powerActionStatus && (
                  <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-200 flex items-center gap-2 animate-pulse">
                    <Power className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{powerActionStatus}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Card 1: Physical Wiring Diagram & Behavior */}
                  <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-rose-400" />
                        40-Pin Header Wiring Diagram
                      </span>
                      <span className="text-[10px] text-neutral-500 font-mono">Standard Pi Header</span>
                    </div>

                    {/* Pin Header Visualizer */}
                    <div className="p-3 bg-neutral-950 border border-neutral-800/80 rounded-lg font-mono text-[11px] text-neutral-400 space-y-1 overflow-x-auto">
                      <div className="flex justify-between text-neutral-500 text-[10px] pb-1 border-b border-neutral-800">
                        <span>Left Col (Odd Pins)</span>
                        <span>Right Col (Even Pins)</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Pin 1: 3.3V Power</span>
                        <span>Pin 2: 5V Power</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Pin 3: GPIO 2 (SDA)</span>
                        <span>Pin 4: 5V Power</span>
                      </div>
                      <div className="flex justify-between font-bold text-rose-300 bg-rose-950/40 px-1 py-0.5 rounded border border-rose-800/40">
                        <span>★ Pin 5: GPIO 3 (SCL) [SW]</span>
                        <span>★ Pin 6: GND (Ground) [SW]</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Pin 7: GPIO 4</span>
                        <span>Pin 8: GPIO 14 (TXD)</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs text-neutral-300 leading-relaxed">
                      <p>
                        <strong className="text-rose-400">Instant Shutdown (No Menu):</strong> Connect any momentary switch across <strong>Pin 5 (GPIO 3)</strong> and <strong>Pin 6 (GND)</strong>. The background Howchoo daemon (<code className="text-neutral-300 font-mono text-[11px]">listen-for-shutdown.service</code>) directly catches the falling edge and shuts down the Pi cleanly without desktop dialogs or interfering with your desktop menu.
                      </p>
                      <p>
                        <strong className="text-emerald-400">Power-On Wake:</strong> When the Pi is halted, pressing the switch grounds GPIO 3, which signals the hardware PMIC to boot up the system automatically.
                      </p>
                    </div>
                  </div>

                  {/* Card 2: Software Instant Shutdown & Verification */}
                  <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-neutral-200 flex items-center gap-1.5">
                          <Power className="w-3.5 h-3.5 text-amber-400" />
                          Software System Power Controls
                        </span>
                        <span className="text-[10px] text-neutral-500">Graceful Unmount</span>
                      </div>
                      <p className="text-xs text-neutral-400 leading-relaxed">
                        Safely unmount filesystems, commit SQLite album recognition history, close active audio pipes, and shut down the Raspberry Pi immediately.
                      </p>
                    </div>

                    {showPowerConfirm ? (
                      <div className="p-3 bg-rose-950/30 border border-rose-800/60 rounded-xl space-y-2.5">
                        <div className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>Confirm immediate {showPowerConfirm === 'shutdown' ? 'system shutdown' : 'system reboot'}?</span>
                        </div>
                        <p className="text-[11px] text-neutral-400">
                          {showPowerConfirm === 'shutdown'
                            ? 'All database sessions and audio streams will be cleanly stopped, and the Pi will power off.'
                            : 'All services will restart and the Raspberry Pi will reboot in ~30 seconds.'}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => handleTriggerPower(showPowerConfirm)}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-colors"
                          >
                            Yes, {showPowerConfirm === 'shutdown' ? 'Shut Down Now' : 'Reboot Now'}
                          </button>
                          <button
                            onClick={() => setShowPowerConfirm(null)}
                            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg text-xs font-medium transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setShowPowerConfirm('shutdown')}
                            className="p-2.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 hover:border-rose-700 text-rose-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span>Shut Down Now</span>
                          </button>
                          <button
                            onClick={() => setShowPowerConfirm('reboot')}
                            className="p-2.5 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-800/60 hover:border-amber-700 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Restart Pi</span>
                          </button>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                            Verify Howchoo Power Daemon Status:
                          </label>
                          <div className="p-2 bg-neutral-950 border border-neutral-800 rounded-lg flex items-center justify-between font-mono text-[11px] text-neutral-300">
                            <span className="truncate mr-2">
                              systemctl status listen-for-shutdown.service
                            </span>
                            <button
                              onClick={() => copyCommand('systemctl status listen-for-shutdown.service', 'check-gpio')}
                              className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white shrink-0"
                              title="Copy Command"
                            >
                              {copiedCmdId === 'check-gpio' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Raspberry Pi Boot Configuration: Desktop vs Headless */}
              <div className="p-5 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-4">
                <div>
                  <div className="flex items-center gap-2 font-bold text-neutral-100 text-sm">
                    <Monitor className="w-4 h-4 text-purple-400" />
                    <span>Raspberry Pi Boot Configuration: Desktop vs. Headless</span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                    Configure your Raspberry Pi to boot either as a headless appliance (saving RAM/CPU) or directly into the desktop with auto-login (ideal for connected HDMI or official touchscreens).
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Mode 1: Desktop with Auto-Login */}
                  <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-3">
                    <div className="flex items-center gap-2 font-bold text-purple-300 text-xs">
                      <Monitor className="w-4 h-4 text-purple-400" />
                      <span>Boot to Desktop with Auto-Login</span>
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      Recommended if you have an HDMI monitor, TV, or Raspberry Pi Touchscreen mounted near your turntable to display live album artwork.
                    </p>
                    
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                        1-Click Command:
                      </label>
                      <div className="p-2 bg-neutral-950 border border-neutral-800 rounded-lg flex items-center justify-between font-mono text-xs text-purple-300">
                        <span className="truncate mr-2">
                          sudo raspi-config nonint do_boot_behaviour B4 && sudo reboot
                        </span>
                        <button
                          onClick={() => copyCommand('sudo raspi-config nonint do_boot_behaviour B4 && sudo reboot', 'boot-desktop')}
                          className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white"
                          title="Copy Command"
                        >
                          {copiedCmdId === 'boot-desktop' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-neutral-400 space-y-1">
                      <span className="font-semibold text-neutral-300">Via interactive menu:</span>
                      <ol className="list-decimal pl-4 space-y-0.5">
                        <li>Run <code className="text-neutral-200 font-mono">sudo raspi-config</code></li>
                        <li>Select <b>1 System Options &rarr; S5 Boot / Auto Login</b></li>
                        <li>Choose <b>B4 Desktop Autologin</b></li>
                        <li>Select Finish and Reboot.</li>
                      </ol>
                    </div>
                  </div>

                  {/* Mode 2: Headless (Console Autologin) */}
                  <div className="p-4 bg-neutral-900/60 border border-neutral-800 rounded-xl space-y-3">
                    <div className="flex items-center gap-2 font-bold text-emerald-300 text-xs">
                      <HardDrive className="w-4 h-4 text-emerald-400" />
                      <span>Boot to Headless (Console Autologin)</span>
                    </div>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      Recommended if running headless in your stereo cabinet without a screen. Disables graphical desktop to save ~400MB RAM and CPU power.
                    </p>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                        1-Click Command:
                      </label>
                      <div className="p-2 bg-neutral-950 border border-neutral-800 rounded-lg flex items-center justify-between font-mono text-xs text-emerald-300">
                        <span className="truncate mr-2">
                          sudo raspi-config nonint do_boot_behaviour B2 && sudo reboot
                        </span>
                        <button
                          onClick={() => copyCommand('sudo raspi-config nonint do_boot_behaviour B2 && sudo reboot', 'boot-headless')}
                          className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white"
                          title="Copy Command"
                        >
                          {copiedCmdId === 'boot-headless' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-neutral-400 space-y-1">
                      <span className="font-semibold text-neutral-300">Via interactive menu:</span>
                      <ol className="list-decimal pl-4 space-y-0.5">
                        <li>Run <code className="text-neutral-200 font-mono">sudo raspi-config</code></li>
                        <li>Select <b>1 System Options &rarr; S5 Boot / Auto Login</b></li>
                        <li>Choose <b>B2 Console Autologin</b></li>
                        <li>Select Finish and Reboot.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>

              {/* Real-Time Live Logs Section */}
              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-3">
                <div className="flex items-center gap-2 font-bold text-neutral-200 text-xs">
                  <Terminal className="w-4 h-4 text-amber-400" />
                  <span>Real-Time Service Log Streaming (Run in Terminal)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-neutral-300 font-medium">
                      <span>Music Recognition</span>
                      <button
                        onClick={() => copyCommand('journalctl --user -u analogair-daemon -f', 'log-daemon')}
                        className="text-neutral-400 hover:text-white"
                        title="Copy"
                      >
                        {copiedCmdId === 'log-daemon' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <code className="text-[11px] text-amber-300 font-mono block truncate">
                      journalctl --user -u analogair-daemon -f
                    </code>
                  </div>

                  <div className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-neutral-300 font-medium">
                      <span>Web & DSP API</span>
                      <button
                        onClick={() => copyCommand('journalctl --user -u analogair-web -f', 'log-web')}
                        className="text-neutral-400 hover:text-white"
                        title="Copy"
                      >
                        {copiedCmdId === 'log-web' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <code className="text-[11px] text-amber-300 font-mono block truncate">
                      journalctl --user -u analogair-web -f
                    </code>
                  </div>

                  <div className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-neutral-300 font-medium">
                      <span>Audio Hardware Capture</span>
                      <button
                        onClick={() => copyCommand('journalctl --user -u analogair-capture -f', 'log-capture')}
                        className="text-neutral-400 hover:text-white"
                        title="Copy"
                      >
                        {copiedCmdId === 'log-capture' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <code className="text-[11px] text-amber-300 font-mono block truncate">
                      journalctl --user -u analogair-capture -f
                    </code>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: PREFERENCES */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-neutral-100">System Preferences</h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Configure album identification, audio source branding, standby artwork, and display behavior.
                </p>
              </div>

              {/* Album Recognition Mode (Default: No Recognition / Resource Saver) */}
              <div className="p-4 sm:p-5 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Album Identification Engine</span>
                  </label>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    !settings.enableRecognition
                      ? 'bg-neutral-800 text-neutral-300 border border-neutral-700'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}>
                    {!settings.enableRecognition ? 'OFF (RESOURCE SAVER)' : 'LIVE IDENTIFICATION ON'}
                  </span>
                </div>

                <p className="text-xs text-neutral-400 leading-relaxed">
                  By default, AnalogAir runs in <strong className="text-neutral-200">No Recognition (Resource Saver)</strong> mode: music plays continuously through OwnTone with zero acoustic CPU/RAM overhead, keeping default art and info displayed without recording to Played Albums. Turn on Album Identification below to enable live Shazam & MusicBrainz lookups.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Option 1: No Recognition (Default) */}
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ enableRecognition: false })}
                    className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all ${
                      !settings.enableRecognition
                        ? 'bg-amber-500/15 border-amber-500/50 text-white shadow-md ring-1 ring-amber-500/30'
                        : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 font-bold text-sm text-neutral-200">
                        <Radio className={`w-4 h-4 ${!settings.enableRecognition ? 'text-amber-400' : 'text-neutral-500'}`} />
                        <span>No Recognition (Default)</span>
                      </div>
                      {!settings.enableRecognition && <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />}
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      <strong>Zero CPU/RAM overhead.</strong> Music plays and streams directly to AirPlay. Retains default artwork & labels. No Shazam queries or session logs. Best for Raspberry Pi Zero, 1, 2, 3, or low memory.
                    </p>
                  </button>

                  {/* Option 2: Live Album Identification */}
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ enableRecognition: true })}
                    className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all ${
                      settings.enableRecognition
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-white shadow-md ring-1 ring-emerald-500/30'
                        : 'bg-neutral-900/60 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 font-bold text-sm text-neutral-200">
                        <Sparkles className={`w-4 h-4 ${settings.enableRecognition ? 'text-emerald-400' : 'text-neutral-500'}`} />
                        <span>Album Identification Active</span>
                      </div>
                      {settings.enableRecognition && <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />}
                    </div>
                    <p className="text-[11px] text-neutral-400 leading-relaxed">
                      <strong>Acoustic Fingerprinting.</strong> Uses Shazam and MusicBrainz to identify vinyl records, auto-fetch high-res cover art, and record spins to the Played Albums tab.
                    </p>
                  </button>
                </div>
              </div>

              {/* Source Type Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Audio Source Hardware Type
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { id: 'vinyl' as const, label: 'Turntable / Vinyl', icon: Disc, desc: 'Vinyl records' },
                    { id: 'tape' as const, label: 'Cassette Deck', icon: CassetteTape, desc: 'Magnetic tape' },
                    { id: 'cd' as const, label: 'CD Player', icon: Disc3, desc: 'Compact disc' },
                    { id: 'aux' as const, label: 'Aux / Line-In', icon: Radio, desc: 'External audio' }
                  ].map((src) => {
                    const isSelected = (settings.sourceType || 'vinyl') === src.id;
                    const IconComp = src.icon;
                    return (
                      <button
                        key={src.id}
                        type="button"
                        onClick={() => {
                          const defaultLabels: Record<string, string> = {
                            vinyl: 'Vinyl Audio Streaming',
                            tape: 'Cassette Audio Streaming',
                            cd: 'CD Audio Streaming',
                            aux: 'Line-In Audio Streaming'
                          };
                          const defaultArts: Record<string, string> = {
                            vinyl: '/assets/default_vinyl.jpg',
                            tape: '/assets/default_tape.jpg',
                            cd: '/assets/default_cd.jpg',
                            aux: '/assets/default_vinyl.jpg'
                          };
                          onUpdateSettings({
                            sourceType: src.id,
                            customStreamLabel: defaultLabels[src.id],
                            defaultArtUrl: defaultArts[src.id]
                          });
                        }}
                        className={`p-3.5 rounded-xl border text-left flex flex-col justify-between transition-all ${
                          isSelected
                            ? 'bg-amber-500/15 border-amber-500/50 text-neutral-100 shadow-md ring-1 ring-amber-500/30'
                            : 'bg-neutral-950/70 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <IconComp className={`w-5 h-5 ${isSelected ? 'text-amber-400' : 'text-neutral-500'}`} />
                          {isSelected && <span className="w-2 h-2 rounded-full bg-amber-400" />}
                        </div>
                        <div>
                          <div className="font-semibold text-xs text-neutral-200">{src.label}</div>
                          <div className="text-[10px] text-neutral-500">{src.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Stream Display Label */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Stream Display Header Label
                </label>
                <input
                  type="text"
                  value={settings.customStreamLabel || ''}
                  placeholder="e.g., Vinyl Audio Streaming, Technics SL-1200, Marantz CD-63..."
                  onChange={(e) => onUpdateSettings({ customStreamLabel: e.target.value })}
                  className="w-full p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500"
                />
                <p className="text-[11px] text-neutral-500">
                  Customizes the top header status line when streaming (e.g. "Cassette Audio Streaming", "Vinyl Audio Streaming").
                </p>
              </div>

              {/* Default Standby Artwork Preset Picker & Upload */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                    Default Standby Artwork
                  </label>
                  <span className="text-[11px] text-neutral-500">
                    Syncs to AirPlay screen (<code className="text-amber-400/90 font-mono">AnalogAir.jpg</code>)
                  </span>
                </div>

                {/* Built-in Presets */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'vinyl', url: '/assets/default_vinyl.jpg', label: 'Turntable Platter' },
                    { id: 'tape', url: '/assets/default_tape.jpg', label: 'Cassette Deck' },
                    { id: 'cd', url: '/assets/default_cd.jpg', label: 'Audiophile CD' }
                  ].map((art) => {
                    const isChosen = settings.defaultArtUrl === art.url;
                    return (
                      <div
                        key={art.id}
                        onClick={() => onUpdateSettings({ defaultArtUrl: art.url })}
                        className={`cursor-pointer rounded-xl overflow-hidden border p-1 transition-all ${
                          isChosen ? 'border-amber-500 ring-2 ring-amber-500/40 bg-amber-500/10' : 'border-neutral-800 hover:border-neutral-700 bg-neutral-950'
                        }`}
                      >
                        <div className="w-full h-20 rounded-lg overflow-hidden bg-neutral-900 mb-1.5">
                          <img src={art.url} alt={art.label} className="w-full h-full object-cover" />
                        </div>
                        <div className="text-[11px] font-medium text-neutral-300 text-center truncate px-1">
                          {art.label}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Upload Personal Standby Image */}
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-300 font-medium flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                      Upload Personal Standby Photo
                    </span>
                    {settings.defaultArtUrl && settings.defaultArtUrl.includes('custom-standby') && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium border border-amber-500/30">
                        Custom Active
                      </span>
                    )}
                  </div>

                  {/* Hidden File Input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileUpload(e.target.files[0]);
                      }
                    }}
                    className="hidden"
                  />

                  {/* Drag-and-Drop or Click Upload Card */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative cursor-pointer rounded-2xl border-2 border-dashed p-4 transition-all text-center flex flex-col items-center justify-center gap-2 ${
                      isDraggingArt
                        ? 'border-amber-500 bg-amber-500/10 scale-[0.99]'
                        : 'border-neutral-800 hover:border-neutral-700 bg-neutral-950/60 hover:bg-neutral-950'
                    }`}
                  >
                    {isUploadingArt ? (
                      <div className="py-3 flex flex-col items-center gap-2 text-amber-400">
                        <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                        <p className="text-xs font-medium">Processing & syncing to OwnTone pipe...</p>
                      </div>
                    ) : settings.defaultArtUrl && settings.defaultArtUrl.includes('custom-standby') ? (
                      <div className="w-full flex items-center gap-3 text-left">
                        <div className="w-16 h-16 rounded-xl overflow-hidden border border-amber-500/40 shrink-0 bg-neutral-900 shadow-md">
                          <img
                            src={settings.defaultArtUrl}
                            alt="Custom standby"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">Personal Standby Photo Active</p>
                          <p className="text-[11px] text-neutral-400 truncate">
                            Replaces album art in <code className="text-amber-400">AnalogAir.jpg</code> upon silence
                          </p>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                            className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
                          >
                            <FileUp className="w-3 h-3 text-amber-400" />
                            Upload Different Photo
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-2 flex flex-col items-center gap-1.5">
                        <div className="w-10 h-10 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 group-hover:text-amber-400 transition-colors">
                          <Upload className="w-5 h-5 text-amber-400" />
                        </div>
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium text-neutral-200">
                            Click to upload or drag & drop personal photo
                          </p>
                          <p className="text-[11px] text-neutral-500">
                            JPEG, PNG, or WebP (up to 25MB). Auto-scaled for AirPlay screens.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {uploadError && (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-950/40 border border-red-800/60 text-red-300 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                      <span>{uploadError}</span>
                    </div>
                  )}

                  {/* OwnTone Silence Gap Auto-Overwrite explanation */}
                  <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 text-[11px] text-neutral-400 leading-relaxed space-y-1">
                    <p className="font-semibold text-neutral-300 flex items-center gap-1.5">
                      <Cast className="w-3.5 h-3.5 text-amber-400" />
                      OwnTone AirPlay Source Pipe Artwork:
                    </p>
                    <p>
                      OwnTone serves the image located at <code className="text-amber-400 font-mono">~/Music/AnalogAir/AnalogAir.jpg</code> to AirPlay screens (Apple TV, HomePod). When audio is actively identified, live album art is written there. When the silence gap timeout is reached, the default image will replace and overwrite <code className="text-amber-400 font-mono">AnalogAir.jpg</code> automatically.
                    </p>
                  </div>
                </div>
              </div>

              {/* Idle Metadata Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-neutral-400">Default Idle Artist (AirPlay Screen)</label>
                  <input
                    type="text"
                    value={settings.idleArtist}
                    onChange={(e) => onUpdateSettings({ idleArtist: e.target.value })}
                    className="w-full p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-neutral-400">Default Idle Album (AirPlay Screen)</label>
                  <input
                    type="text"
                    value={settings.idleAlbum}
                    onChange={(e) => onUpdateSettings({ idleAlbum: e.target.value })}
                    className="w-full p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-neutral-400">Silence Gap Timeout Before Idle</label>
                  <select
                    value={settings.silenceGapSeconds}
                    onChange={(e) => onUpdateSettings({ silenceGapSeconds: parseInt(e.target.value, 10) })}
                    className="w-full p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option value={10}>10 Seconds</option>
                    <option value={15}>15 Seconds</option>
                    <option value={20}>20 Seconds (Standard)</option>
                    <option value={30}>30 Seconds</option>
                    <option value={45}>45 Seconds</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-neutral-400">Touchscreen Dimmer Timeout</label>
                  <select
                    value={settings.dimMinutes}
                    onChange={(e) => onUpdateSettings({ dimMinutes: parseInt(e.target.value, 10) })}
                    className="w-full p-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-amber-500"
                  >
                    <option value={10}>10 Minutes</option>
                    <option value={15}>15 Minutes</option>
                    <option value={25}>25 Minutes (Default)</option>
                    <option value={45}>45 Minutes</option>
                    <option value={0}>Never Dim (Always On)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          </ErrorBoundary>
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 bg-neutral-950 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-500 font-mono">
          <span>PipeWire DSP • OwnTone API (Port 3689)</span>
          <span>Tap anywhere outside or close to resume fullscreen</span>
        </div>
      </div>
    </div>
  );
};
