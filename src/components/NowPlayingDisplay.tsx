import React, { useState, useEffect, useMemo } from 'react';
import { Disc, Music, Sliders, Radio, Sparkles, CheckCircle2, CassetteTape, Disc3, Mic2, Maximize2, Minimize2 } from 'lucide-react';
import { NowPlayingState, SystemPreferences } from '../types';
import { sanitizeAlbumTitle, sanitizeTrackTitle } from '../utils/sanitize';
import vinylDefaultArt from '../assets/images/analogair_idle_art_1788723997443.jpg';
import tapeDefaultArt from '../assets/images/analogair_tape_art_1788735610103.jpg';
import cdDefaultArt from '../assets/images/analogair_cd_art_1788735621912.jpg';

interface NowPlayingDisplayProps {
  state: NowPlayingState;
  settings?: SystemPreferences;
  onOpenControls: () => void;
  onOpenEditMetadata: () => void;
}

export const NowPlayingDisplay: React.FC<NowPlayingDisplayProps> = ({
  state,
  settings,
  onOpenControls,
  onOpenEditMetadata
}) => {
  const [imageError, setImageError] = useState(false);
  const [useLocalFallback, setUseLocalFallback] = useState(false);
  const [fallbackLevel, setFallbackLevel] = useState<number>(0);
  const [isFaded, setIsFaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isIdle = state.status === 'idle';

  // Monitor document fullscreen status
  useEffect(() => {
    const updateFsState = () => {
      const doc = document as any;
      const fsElement = doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement;
      setIsFullscreen(Boolean(fsElement));
    };

    updateFsState();
    document.addEventListener('fullscreenchange', updateFsState);
    document.addEventListener('webkitfullscreenchange', updateFsState);
    document.addEventListener('mozfullscreenchange', updateFsState);
    document.addEventListener('MSFullscreenChange', updateFsState);

    return () => {
      document.removeEventListener('fullscreenchange', updateFsState);
      document.removeEventListener('webkitfullscreenchange', updateFsState);
      document.removeEventListener('mozfullscreenchange', updateFsState);
      document.removeEventListener('MSFullscreenChange', updateFsState);
    };
  }, []);

  const toggleFullscreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const doc = document as any;
      const el = document.documentElement as any;
      const isFs = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);

      if (!isFs) {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else if (el.mozRequestFullScreen) {
          await el.mozRequestFullScreen();
        } else if (el.msRequestFullscreen) {
          await el.msRequestFullscreen();
        }
      } else {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  };

  const sourceType = settings?.sourceType || state.sourceType || 'vinyl';

  const displayAlbum = useMemo(() => sanitizeAlbumTitle(state.album), [state.album]);
  const displayTitle = useMemo(() => sanitizeTrackTitle(state.title), [state.title]);

  // Reset image error and fallback states when artUrl, album, artist, or status changes
  useEffect(() => {
    setImageError(false);
    setUseLocalFallback(false);
    setFallbackLevel(0);
  }, [state.artUrl, state.album, state.artist, state.status, sourceType]);

  // 10-Second Idle Auto-Fade Timer
  // Fades out header, footer, and edit buttons, leaving purely the artwork, artist, and title.
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const resetIdleTimer = () => {
      setIsFaded(false);
      clearTimeout(timer);
      const timeoutMs = (settings?.idleFadeSeconds ?? 10) * 1000;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          setIsFaded(true);
        }, timeoutMs);
      }
    };

    resetIdleTimer();

    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('mousedown', resetIdleTimer);
    window.addEventListener('touchstart', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', resetIdleTimer);
      window.removeEventListener('mousedown', resetIdleTimer);
      window.removeEventListener('touchstart', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
    };
  }, [settings?.idleFadeSeconds]);

  // Static bundled artwork by source type
  const bundledSourceArt = useMemo(() => {
    if (sourceType === 'tape') return tapeDefaultArt;
    if (sourceType === 'cd') return cdDefaultArt;
    return vinylDefaultArt;
  }, [sourceType]);

  // Multi-tier artwork resolution with seamless failover
  // Level 0: Primary source (state.artUrl when playing, or configured default / custom-standby)
  // Level 1: Standby local Pi image (/api/artwork/custom-standby.jpg)
  // Level 2: Live audio pipe mirror (/api/artwork/current.jpg)
  // Level 3: Static bundled image asset (vinylDefaultArt, tapeDefaultArt, cdDefaultArt)
  // Level 4: Pure CSS/SVG vector sleeve (never breaks, zero network dependency)
  const displayArt = useMemo(() => {
    if (fallbackLevel >= 4) return '';
    if (fallbackLevel === 3) return bundledSourceArt;
    if (fallbackLevel === 2) return `/api/artwork/current.jpg?v=${Date.now()}`;
    if (fallbackLevel === 1) return `/api/artwork/custom-standby.jpg?v=${Date.now()}`;

    if (isIdle) {
      if (settings?.defaultArtUrl && settings.defaultArtUrl.trim() && !settings.defaultArtUrl.includes('default_vinyl.jpg')) {
        return settings.defaultArtUrl;
      }
      return '/api/artwork/custom-standby.jpg';
    }

    if (useLocalFallback) return `/api/artwork/current.jpg?v=${Date.now()}`;
    if (state.artUrl && state.artUrl.trim()) return state.artUrl;
    return '/api/artwork/custom-standby.jpg';
  }, [fallbackLevel, bundledSourceArt, isIdle, settings?.defaultArtUrl, useLocalFallback, state.artUrl]);

  const handleImageError = () => {
    setFallbackLevel(prev => prev + 1);
  };

  // Stream label text based on source preference
  const streamLabel = useMemo(() => {
    if (isIdle) {
      if (sourceType === 'tape') return 'Standby (Deck Stopped)';
      if (sourceType === 'cd') return 'Standby (Disc Stopped)';
      if (sourceType === 'aux') return 'Standby (No Signal)';
      return 'Standby (Needle Lifted)';
    }

    if (settings?.customStreamLabel?.trim()) {
      return settings.customStreamLabel.trim();
    }

    switch (sourceType) {
      case 'tape':
        return 'Cassette Audio Streaming';
      case 'cd':
        return 'CD Audio Streaming';
      case 'aux':
        return 'Line-In Audio Streaming';
      case 'vinyl':
      default:
        return 'Vinyl Audio Streaming';
    }
  }, [isIdle, settings?.customStreamLabel, sourceType]);

  // Dynamic "Shrink-to-Fit" Typography Sizing based on character length
  const albumLength = displayAlbum?.length || 0;
  const albumTitleSizeClass = useMemo(() => {
    if (albumLength > 60) return 'text-xl sm:text-2xl md:text-3xl';
    if (albumLength > 40) return 'text-2xl sm:text-3xl md:text-4xl';
    if (albumLength > 24) return 'text-3xl sm:text-4xl md:text-5xl';
    return 'text-4xl sm:text-5xl md:text-6xl';
  }, [albumLength]);

  const artistLength = state.artist?.length || 0;
  const artistSizeClass = useMemo(() => {
    if (artistLength > 45) return 'text-sm sm:text-base md:text-lg';
    if (artistLength > 28) return 'text-base sm:text-lg md:text-xl';
    return 'text-lg sm:text-xl md:text-2xl';
  }, [artistLength]);

  const handleScreenClick = (e: React.MouseEvent) => {
    if (isFaded) {
      // If currently faded, first tap wakes up the interface controls
      e.stopPropagation();
      setIsFaded(false);
    } else {
      // If already awake, tapping background opens the controls modal
      onOpenControls();
    }
  };

  return (
    <div
      onClick={handleScreenClick}
      className="relative w-full h-screen bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 flex flex-col items-center justify-between p-6 sm:p-10 select-none cursor-pointer overflow-hidden transition-colors"
    >
      {/* Background ambient color bleed */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-25">
        <img
          src={displayArt}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover blur-3xl scale-125 transition-all duration-1000"
        />
      </div>

      {/* TOP STATUS BAR (Fades out after 10s idle) */}
      <header
        className={`relative z-20 w-full max-w-5xl flex items-center justify-between text-xs font-mono text-neutral-400 transition-all duration-1000 ${
          isFaded ? 'opacity-0 pointer-events-none -translate-y-2' : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${isIdle ? 'bg-amber-500/50' : 'bg-emerald-400 animate-pulse'}`} />
          <span className="font-bold text-neutral-200 tracking-wide">AnalogAir</span>
          <span className="text-neutral-600">|</span>
          <span className="text-neutral-300 font-medium">
            {streamLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Badge 1: Saved Metadata Override */}
          {state.matchedVia === 'local_override' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Custom Metadata Saved</span>
              <span className="sm:hidden">Saved</span>
            </span>
          )}

          {/* Badge 2: Identification Mode */}
          {!settings?.enableRecognition ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-800/90 text-neutral-300 border border-neutral-700/80 text-[11px] font-semibold">
              <Radio className="w-3.5 h-3.5 text-neutral-400" />
              <span>Direct Stream (No ID)</span>
            </span>
          ) : state.isContinuous ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-semibold">
              <Music className="w-3.5 h-3.5 text-sky-400" />
              <span>Song ID Mode</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-semibold">
              <Disc className="w-3.5 h-3.5 text-amber-400" />
              <span>Album Side Lock Active</span>
            </span>
          )}

          {/* Controls button */}
          <button
            id="open-controls-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenControls();
            }}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-neutral-800/90 hover:bg-neutral-700 text-neutral-100 rounded-xl border border-neutral-700/80 transition-colors text-xs font-sans font-medium ml-1 shadow-lg active:scale-95"
          >
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            <span>Controls</span>
          </button>

          {/* Go Full Screen / Exit Full Screen button */}
          <button
            id="fullscreen-toggle-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen' : 'Go Full Screen'}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-neutral-800/90 hover:bg-neutral-700 text-neutral-100 rounded-xl border border-neutral-700/80 transition-colors text-xs font-sans font-medium shadow-lg active:scale-95"
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Exit Full Screen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Go Full Screen</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* MAIN CENTER STAGE: Album Sleeve, Media Peeking Visual, and Scaled Typography */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center w-full max-w-4xl text-center py-4 my-auto">
        <div className="relative group mb-6 sm:mb-8">
          {/* Media Graphic Peeking Behind Sleeve (Vinyl Disc, Cassette, or CD) */}
          {sourceType === 'vinyl' && (
            <div
              className={`absolute -right-4 sm:-right-8 top-1/2 -translate-y-1/2 w-48 h-48 sm:w-80 sm:h-80 rounded-full bg-neutral-950 border-[6px] border-neutral-900 shadow-2xl transition-transform duration-700 pointer-events-none ${
                !isIdle ? 'translate-x-6 sm:translate-x-12 rotate-45' : 'translate-x-0'
              }`}
              style={{
                background: 'radial-gradient(circle, #262626 15%, #0a0a0a 16%, #171717 38%, #0f0f0f 55%, #1a1a1a 75%, #050505 100%)'
              }}
            >
              <div className="absolute inset-0 m-auto w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-amber-600/90 border-4 border-amber-500/30 flex items-center justify-center shadow-inner">
                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-neutral-950" />
              </div>
            </div>
          )}

          {sourceType === 'tape' && (
            <div
              className={`absolute -right-4 sm:-right-8 top-1/2 -translate-y-1/2 w-44 h-32 sm:w-72 sm:h-52 rounded-xl bg-neutral-900 border-4 border-neutral-800 shadow-2xl transition-transform duration-700 pointer-events-none p-3 flex flex-col justify-between ${
                !isIdle ? 'translate-x-6 sm:translate-x-10 -rotate-3' : 'translate-x-0'
              }`}
            >
              <div className="flex justify-between items-center text-[9px] font-mono text-amber-500/80 px-2">
                <span>TYPE II CrO2</span>
                <span>SIDE A</span>
              </div>
              <div className="h-12 sm:h-20 bg-neutral-950 rounded-lg border border-neutral-800 flex items-center justify-around px-4">
                <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full border-2 border-dashed border-amber-400/60 animate-spin flex items-center justify-center" style={{ animationDuration: '4s' }}>
                  <div className="w-2 h-2 rounded-full bg-neutral-700" />
                </div>
                <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full border-2 border-dashed border-amber-400/60 animate-spin flex items-center justify-center" style={{ animationDuration: '4s' }}>
                  <div className="w-2 h-2 rounded-full bg-neutral-700" />
                </div>
              </div>
              <div className="text-[10px] font-mono text-neutral-500 text-center">ANALOG HIGH BIAS</div>
            </div>
          )}

          {sourceType === 'cd' && (
            <div
              className={`absolute -right-4 sm:-right-8 top-1/2 -translate-y-1/2 w-48 h-48 sm:w-80 sm:h-80 rounded-full border-[5px] border-neutral-700/80 shadow-2xl transition-transform duration-700 pointer-events-none ${
                !isIdle ? 'translate-x-6 sm:translate-x-12 rotate-90' : 'translate-x-0'
              }`}
              style={{
                background: 'radial-gradient(circle, #f3f4f6 12%, #38bdf8 30%, #eab308 55%, #c084fc 75%, #1f2937 100%)'
              }}
            >
              <div className="absolute inset-0 m-auto w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-neutral-950/90 border-4 border-neutral-400/40 flex items-center justify-center shadow-inner">
                <div className="w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-white/20" />
              </div>
            </div>
          )}

          {/* Sleeve & Front Artwork */}
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.85)] border border-neutral-800/90 bg-neutral-900 transition-transform duration-500">
            {fallbackLevel < 4 && displayArt ? (
              <img
                key={displayArt}
                src={displayArt}
                alt={displayAlbum}
                referrerPolicy="no-referrer"
                onError={handleImageError}
                className="w-full h-full object-cover select-none pointer-events-none transition-transform duration-700 group-hover:scale-105"
              />
            ) : (
              /* Built-in Standby Sleeve SVG/CSS Canvas (Immune to network/file errors) */
              <div className="w-full h-full flex flex-col items-center justify-center p-6 bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900 select-none relative overflow-hidden">
                {/* Grooved concentric circles */}
                <div className="absolute inset-4 rounded-full border border-neutral-800/80 pointer-events-none" />
                <div className="absolute inset-10 rounded-full border border-neutral-800/60 pointer-events-none" />
                <div className="absolute inset-16 rounded-full border border-neutral-800/40 pointer-events-none" />
                <div className="absolute inset-24 rounded-full border border-neutral-800/30 pointer-events-none" />
                
                {/* Center Label */}
                <div className="relative z-10 w-28 h-28 sm:w-36 sm:h-36 rounded-full bg-gradient-to-tr from-amber-600 via-amber-500 to-amber-600 border-4 border-amber-400/40 shadow-2xl flex flex-col items-center justify-center text-center p-2">
                  <Disc3 className="w-8 h-8 sm:w-10 sm:h-10 text-neutral-950 mb-1" />
                  <span className="text-[10px] sm:text-xs font-black tracking-wider uppercase text-neutral-950 leading-tight">
                    {sourceType === 'tape' ? 'CASSETTE' : sourceType === 'cd' ? 'COMPACT DISC' : 'ANALOGAIR'}
                  </span>
                  <span className="text-[8px] sm:text-[9px] font-mono tracking-widest text-neutral-900/80 font-bold">
                    HIGH FIDELITY
                  </span>
                  {/* Center spindle hole */}
                  <div className="absolute w-3.5 h-3.5 rounded-full bg-neutral-950 border border-amber-300/40" />
                </div>

                <div className="absolute bottom-3 text-[10px] font-mono tracking-widest text-neutral-500 uppercase">
                  {displayAlbum}
                </div>
              </div>
            )}

            {/* Subtle high-fidelity gloss overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 pointer-events-none" />

            {/* Quick edit button badge (Fades out when idle) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenEditMetadata();
              }}
              title="Edit Album Metadata / Artwork"
              className={`absolute bottom-3.5 right-3.5 px-3 py-1.5 rounded-xl bg-black/80 hover:bg-black text-amber-300 text-xs font-semibold backdrop-blur-md border border-neutral-700/90 transition-all duration-700 flex items-center gap-1.5 shadow-xl ${
                isFaded ? 'opacity-0 pointer-events-none' : 'opacity-100 hover:scale-105'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Edit Info</span>
            </button>
          </div>
        </div>

        {/* Scaled & Shrink-to-Fit Typography (Guaranteed No Overflows or Truncation) */}
        <div className="space-y-2 max-w-2xl px-4 w-full">
          {/* Album Title */}
          <h1
            className={`font-extrabold text-neutral-100 tracking-tight leading-tight drop-shadow-md break-words transition-all duration-300 ${albumTitleSizeClass}`}
          >
            {displayAlbum}
          </h1>

          {/* Artist Name */}
          <h2
            className={`font-medium text-neutral-400 tracking-wide break-words transition-all duration-300 ${artistSizeClass}`}
          >
            {state.artist}
          </h2>

          {/* Real-time Song-Level Title (When continuous recognition is on or active) */}
          {state.isContinuous && displayTitle && displayTitle !== displayAlbum && (
            <div className="pt-2 flex items-center justify-center">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs sm:text-sm font-semibold shadow-inner animate-in fade-in">
                <Music className="w-3.5 h-3.5 animate-bounce" />
                <span className="truncate max-w-xs sm:max-w-md">Track: {displayTitle}</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* BOTTOM FOOTER (Fades out after 10s idle) */}
      <footer
        className={`relative z-20 w-full max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-neutral-500 border-t border-neutral-800/80 pt-4 transition-all duration-1000 ${
          isFaded ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100 translate-y-0'
        }`}
      >
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 text-neutral-400">
            <Radio className="w-3.5 h-3.5 text-amber-400" />
            <span>AirPlay & Cast Active</span>
          </span>
          <span>•</span>
          <span>PipeWire 44.1kHz / 16-bit</span>
          <span>•</span>
          <span className="hidden md:inline truncate max-w-[220px]">{state.inputDeviceName}</span>
        </div>

        <div className="flex items-center gap-2 text-neutral-400 font-sans text-xs bg-neutral-900/80 px-3.5 py-1.5 rounded-full border border-neutral-800">
          <span>Tap anywhere on screen for controls & speakers</span>
        </div>
      </footer>
    </div>
  );
};
