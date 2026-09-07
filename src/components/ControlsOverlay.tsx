import React, { useState, useRef } from 'react';
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
  AlertCircle
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

interface ControlsOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  state: NowPlayingState;
  tone: ToneControls;
  outputs: OwnToneOutput[];
  sessions: PlaySession[];
  settings: SystemPreferences;
  onUpdateTone: (newTone: Partial<ToneControls>) => void;
  onToggleOutput: (id: string) => void;
  onUpdateOutputVolume: (id: string, vol: number) => void;
  onToggleFavoriteOutput: (id: string) => void;
  onToggleMode: (continuous: boolean) => void;
  onOpenEditMetadata: () => void;
  onSimulateNeedleDrop: () => void;
  onSimulateSilence: () => void;
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
  onSimulateNeedleDrop,
  onSimulateSilence,
  onUpdateSettings,
  onDeleteSession
}) => {
  const [activeTab, setActiveTab] = useState<'quick' | 'tone' | 'speakers' | 'history' | 'install' | 'settings'>('quick');
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [isUploadingArt, setIsUploadingArt] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDraggingArt, setIsDraggingArt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const copyInstallCommand = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://analogair.local:3000';
    navigator.clipboard.writeText(`curl -sSL ${origin}/api/installer/script | bash`);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
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
            onClick={() => setActiveTab('install')}
            className={`py-3 px-4 border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'install' ? 'border-amber-500 text-amber-400 bg-amber-500/5' : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-emerald-400">Pi Installer Guide</span>
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
          {/* TAB 1: QUICK ACTIONS & NOW PLAYING */}
          {activeTab === 'quick' && (
            <div className="space-y-6">
              {/* Metadata Quick Overview Card */}
              <div className="p-5 bg-neutral-950/70 border border-neutral-800 rounded-2xl flex flex-col sm:flex-row gap-5 items-center justify-between">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 flex-shrink-0 shadow-md">
                    <img
                      src={state.artUrl || '/assets/default_idle.jpg'}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded font-mono bg-neutral-800 text-amber-400 border border-neutral-700">
                        {state.status === 'idle' ? 'STANDBY' : 'STREAMING'}
                      </span>
                      {state.matchedVia === 'local_override' && (
                        <span className="text-xs px-2 py-0.5 rounded font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                          Custom Saved
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-white leading-snug">{state.album}</h3>
                    <p className="text-sm text-neutral-400">{state.artist}</p>
                    {state.title && (
                      <p className="text-xs text-neutral-500 font-mono">Current Track: {state.title}</p>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              {/* Simulation Testing Suite */}
              <div className="p-4 bg-neutral-950/40 border border-neutral-800/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Live Simulation & Testing Triggers</span>
                  </span>
                  <span className="text-[11px] text-neutral-500 font-mono">Test transitions without turntable</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                  <button
                    onClick={onSimulateNeedleDrop}
                    className="p-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-neutral-700"
                  >
                    <Disc className="w-4 h-4 text-amber-400" />
                    <span>Drop Needle (New Record Side)</span>
                  </button>
                  <button
                    onClick={onSimulateSilence}
                    className="p-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-neutral-700"
                  >
                    <RotateCcw className="w-4 h-4 text-sky-400" />
                    <span>Trigger Silence (Revert to Idle)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TONE & GAIN CONTROLS (PIPEWIRE DSP) */}
          {activeTab === 'tone' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-neutral-100">Audio Preamp & Tone Equalizer</h3>
                  <p className="text-xs text-neutral-400">
                    Processed in real-time via PipeWire filter-chain before injecting into OwnTone.
                  </p>
                </div>
                <button
                  onClick={() => onUpdateTone({ inputGainDb: 0, bassGainDb: 0, midGainDb: 0, trebleGainDb: 0 })}
                  className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 transition-colors"
                >
                  Reset Flat (0 dB)
                </button>
              </div>

              {/* Real-time Visualizer */}
              <ToneVisualizer
                bassDb={tone.bassGainDb}
                midDb={tone.midGainDb || 0}
                trebleDb={tone.trebleGainDb}
                gainDb={tone.inputGainDb}
              />

              {/* Capture Device Selector */}
              <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-2">
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Active USB Audio Capture Interface
                </label>
                <select
                  value={tone.selectedDeviceId}
                  onChange={(e) => onUpdateTone({ selectedDeviceId: e.target.value })}
                  className="w-full p-2.5 bg-neutral-900 border border-neutral-700 rounded-xl text-neutral-100 text-sm focus:outline-none focus:border-amber-500"
                >
                  {tone.deviceList.map((dev) => (
                    <option key={dev.id} value={dev.id}>
                      {dev.name} ({dev.supportedRates.join('/')} Hz)
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-neutral-500">
                  PipeWire automatically converts fixed 16/48000 or multi-rate 24/96000 inputs to pristine 16/44100 without clock drift.
                </p>
              </div>

              {/* Sliders Grid: 4-Band DSP Equalizer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Input Preamp Gain */}
                <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-3">
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span className="text-neutral-300">Input Preamp</span>
                    <span className="font-mono text-amber-400">
                      {tone.inputGainDb > 0 ? `+${tone.inputGainDb}` : tone.inputGainDb} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={tone.inputGainDb}
                    onChange={(e) => onUpdateTone({ inputGainDb: parseFloat(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                  <p className="text-[11px] text-neutral-500">
                    Capture level sensitivity to prevent analog clipping.
                  </p>
                </div>

                {/* Bass Shelf (100 Hz) */}
                <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-3">
                  <div className="flex justify-between items-center text-sm font-semibold">
                    <span className="text-neutral-300">Bass (100 Hz)</span>
                    <span className="font-mono text-amber-400">
                      {tone.bassGainDb > 0 ? `+${tone.bassGainDb}` : tone.bassGainDb} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={tone.bassGainDb}
                    onChange={(e) => onUpdateTone({ bassGainDb: parseFloat(e.target.value) })}
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
                      {(tone.midGainDb || 0) > 0 ? `+${tone.midGainDb}` : (tone.midGainDb || 0)} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={tone.midGainDb || 0}
                    onChange={(e) => onUpdateTone({ midGainDb: parseFloat(e.target.value) })}
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
                      {tone.trebleGainDb > 0 ? `+${tone.trebleGainDb}` : tone.trebleGainDb} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.5"
                    value={tone.trebleGainDb}
                    onChange={(e) => onUpdateTone({ trebleGainDb: parseFloat(e.target.value) })}
                    className="w-full accent-sky-500"
                  />
                  <p className="text-[11px] text-neutral-500">
                    High-frequency sparkle or softening record surface hiss.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: OWNTONE SPEAKERS */}
          {activeTab === 'speakers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-neutral-100">AirPlay & Speaker Outputs</h3>
                  <p className="text-xs text-neutral-400">
                    Toggling any destination automatically engages it at 100% volume.
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
                            <h4 className="text-sm font-bold text-neutral-100 flex items-center gap-1.5">
                              <span>{out.name}</span>
                              {out.isFavorite && (
                                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
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
                            title="Toggle Favorite"
                            className="p-2 text-neutral-500 hover:text-amber-400 transition-colors"
                          >
                            <Star className={`w-4 h-4 ${out.isFavorite ? 'text-amber-400 fill-amber-400' : ''}`} />
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
                          <img src={sess.artUrl} alt="" className="w-full h-full object-cover" />
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

          {/* TAB 5: RASPBERRY PI INSTALLER & ARCHITECTURE GUIDE */}
          {activeTab === 'install' && (
            <div className="space-y-6 text-sm leading-relaxed">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
                <h3 className="font-bold text-emerald-300 text-base mb-1">Debian 13 (Trixie) & Debian 12 Installer</h3>
                <p className="text-xs text-neutral-300">
                  Interactive setup script that configures PipeWire zero-latency audio routing, OwnTone AirPlay/Chromecast server, metadata recognition daemon, and background systemd services.
                </p>
              </div>

              {/* Desktop Launcher (.desktop file) */}
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-amber-300 text-sm">
                      <FileCode className="w-4 h-4 text-amber-400" />
                      <span>Raspberry Pi Desktop 1-Click Launcher</span>
                    </div>
                    <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
                      Download this file to your Raspberry Pi desktop. Double-click it (or right-click &rarr; <b>Execute</b>) to automatically launch the installer in a terminal window.
                    </p>
                  </div>
                  <a
                    href="/api/installer/desktop-shortcut"
                    download="Install-AnalogAir.desktop"
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 flex-shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Launcher (.desktop)</span>
                  </a>
                </div>
              </div>

              {/* 1-Line Command */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  1-Line Terminal Install Command
                </label>
                <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl flex items-center justify-between font-mono text-xs text-amber-300">
                  <span className="truncate mr-2">
                    {typeof window !== 'undefined' ? `curl -sSL ${window.location.origin}/api/installer/script | bash` : 'curl -sSL http://analogair.local:3000/api/installer/script | bash'}
                  </span>
                  <button
                    onClick={copyInstallCommand}
                    className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
                  >
                    {copiedCmd ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* GitHub Remote Install Notice */}
              <div className="p-4 bg-neutral-950/70 border border-neutral-800 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 font-bold text-sky-400 text-xs">
                  <Share2 className="w-4 h-4" />
                  <span>Public GitHub Deployment (Install on Any Pi)</span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Want to install this easily on any fresh Raspberry Pi without having the web app running yet? You can push this project to a public repository on GitHub. Once pushed, anyone can install AnalogAir directly by running:
                </p>
                <div className="p-2.5 bg-neutral-900 border border-neutral-800 rounded-xl font-mono text-xs text-neutral-300 select-all overflow-x-auto">
                  curl -sSL https://raw.githubusercontent.com/&lt;your-github-username&gt;/analogair/main/install.sh | bash
                </div>
              </div>

              {/* Download Individual Files */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Download Standalone Components
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <a
                    href="/api/installer/script"
                    download="install.sh"
                    className="p-3 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-xl flex items-center justify-between text-neutral-200 text-xs font-medium transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-amber-400" />
                      <span>install.sh (Bash Script)</span>
                    </span>
                    <Download className="w-4 h-4 text-neutral-500" />
                  </a>
                  <a
                    href="/api/installer/daemon"
                    download="analogair_daemon.py"
                    className="p-3 bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 rounded-xl flex items-center justify-between text-neutral-200 text-xs font-medium transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Disc className="w-4 h-4 text-sky-400" />
                      <span>analogair_daemon.py (Python)</span>
                    </span>
                    <Download className="w-4 h-4 text-neutral-500" />
                  </a>
                </div>
              </div>

              {/* Clean Audio Architecture Overview */}
              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-emerald-400">
                  <Info className="w-4 h-4" />
                  <span>Lossless PipeWire Audio Engine & Hardware Clock Sync</span>
                </div>
                <p className="text-neutral-400 leading-relaxed">
                  AnalogAir streams uncompressed 16-bit / 44.1kHz PCM stereo audio to your AirPlay, Chromecast, and network speakers.
                </p>
                <p className="text-neutral-400 leading-relaxed">
                  PipeWire uses a real-time graph engine with hardware clock synchronization. This eliminates buffer overruns, clicks, and clock drift regardless of whether your USB sound card captures at 44.1kHz, 48kHz, or 96kHz. The 3-band parametric equalizer operates directly in kernel-space with zero latency.
                </p>
              </div>

              {/* Headless Switch Instructions */}
              <div className="p-4 bg-neutral-950/80 border border-neutral-800 rounded-2xl space-y-2 text-xs">
                <span className="font-bold text-neutral-200">Switching from Desktop to Headless Boot</span>
                <ol className="list-decimal pl-5 space-y-1 text-neutral-400">
                  <li>Test your vinyl audio and web interface in the Raspberry Pi desktop browser.</li>
                  <li>Run <code className="text-amber-300 font-mono">sudo raspi-config</code> in terminal.</li>
                  <li>Go to <b>System Options &rarr; Boot / Auto Login</b> and select <b>Console Autologin</b>.</li>
                  <li>Reboot. The services run automatically in the background, accessible from any phone or laptop on your LAN at <code className="text-amber-300 font-mono">http://analogair.local:3000</code>.</li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 6: PREFERENCES */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-neutral-100">System Preferences</h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Configure audio source branding, standby artwork, and display behavior.
                </p>
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
