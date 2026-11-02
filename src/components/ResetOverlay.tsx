import React from 'react';
import { Disc3, RefreshCw, Volume2, Radio, CheckCircle2 } from 'lucide-react';

interface ResetOverlayProps {
  isOpen: boolean;
  message?: string;
  autoConnectSpeakers?: string[];
}

export const ResetOverlay: React.FC<ResetOverlayProps> = ({
  isOpen,
  message,
  autoConnectSpeakers = []
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-neutral-950/90 backdrop-blur-2xl select-none animate-in fade-in duration-300"
    >
      {/* Background ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none animate-pulse" />
      </div>

      <div className="relative w-full max-w-md bg-neutral-900/90 border border-amber-500/30 rounded-3xl p-7 shadow-2xl shadow-black/80 flex flex-col items-center text-center">
        {/* Animated Vinyl & Speaker Badge */}
        <div className="relative mb-6">
          <div className="w-20 h-20 rounded-2xl bg-neutral-950/80 border border-amber-500/40 flex items-center justify-center shadow-inner shadow-black/60 relative overflow-hidden">
            <Disc3 className="w-10 h-10 text-amber-400 animate-spin [animation-duration:3s]" />
            <div className="absolute inset-0 border border-amber-500/20 rounded-2xl animate-ping opacity-25" />
          </div>
          <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-300 shadow-md">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
        </div>

        {/* Heading */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-semibold tracking-wider uppercase mb-3">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          2-Hour Inactivity Reset
        </div>

        <h3 className="text-xl font-bold text-white tracking-tight mb-2">
          Resetting OwnTone & Pipeline
        </h3>

        <p className="text-xs text-neutral-400 leading-relaxed max-w-sm mb-6">
          {message || '2 hours of silence & inactivity detected. Purging audio buffers, restarting OwnTone, and re-establishing auto-connect speakers for pristine zero-latency playback.'}
        </p>

        {/* Steps Status */}
        <div className="w-full bg-neutral-950/60 border border-neutral-800/80 rounded-2xl p-4 text-left space-y-3 mb-6">
          <div className="flex items-center gap-3 text-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-neutral-300">PipeWire audio backlog flushed</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
            <span className="text-neutral-200 font-medium">Restarting OwnTone AirPlay & Cast daemon...</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Volume2 className="w-4 h-4 text-amber-400/80 shrink-0 animate-pulse" />
            <span className="text-neutral-400">
              Re-attaching designated auto-connect speakers
              {autoConnectSpeakers.length > 0 && ` (${autoConnectSpeakers.length} saved)`}
            </span>
          </div>
        </div>

        {/* Real-time Indicator */}
        <div className="flex items-center gap-2 text-[11px] text-amber-400/80 font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          <span>Resuming audio stream in ~2 seconds...</span>
        </div>
      </div>
    </div>
  );
};

export default ResetOverlay;
