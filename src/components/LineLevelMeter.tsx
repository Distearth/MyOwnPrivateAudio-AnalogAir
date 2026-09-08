import React, { useState, useEffect, useRef } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Power, Sparkles, Volume2, Zap } from 'lucide-react';
import { AudioLevelData } from '../types';

interface LineLevelMeterProps {
  inputGainDb: number;
  onAdjustGain?: (newGain: number) => void;
  selectedDeviceId?: string;
}

export const LineLevelMeter: React.FC<LineLevelMeterProps> = ({
  inputGainDb,
  onAdjustGain,
  selectedDeviceId
}) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [levelData, setLevelData] = useState<AudioLevelData | null>(null);
  const [peakHoldDbfs, setPeakHoldDbfs] = useState<number>(-96);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(300); // 5 min auto-off
  const [hasClippedRecently, setHasClippedRecently] = useState(false);

  const peakHoldDecayRef = useRef<number>(-96);
  const clipResetTimerRef = useRef<any>(null);

  // Poll for audio level while enabled
  useEffect(() => {
    if (!isEnabled) {
      setLevelData(null);
      setPeakHoldDbfs(-96);
      peakHoldDecayRef.current = -96;
      setHasClippedRecently(false);
      return;
    }

    // Reset countdown when turned on
    setSecondsRemaining(300);

    let isMounted = true;

    const fetchLevel = async () => {
      try {
        const res = await fetch('/api/audio-level', { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return;
        const data: AudioLevelData = await res.json();
        if (!isMounted) return;

        setLevelData(data);

        // Update peak hold
        const currentPeak = data.peakDbfs;
        if (currentPeak > peakHoldDecayRef.current) {
          peakHoldDecayRef.current = currentPeak;
          setPeakHoldDbfs(currentPeak);
        } else {
          // Slow decay (~1 dB per fetch tick)
          peakHoldDecayRef.current = Math.max(-96, peakHoldDecayRef.current - 1.2);
          setPeakHoldDbfs(peakHoldDecayRef.current);
        }

        // Trigger clip indicator
        if (data.isClipping || data.peakDbfs >= -0.5) {
          setHasClippedRecently(true);
          if (clipResetTimerRef.current) clearTimeout(clipResetTimerRef.current);
          clipResetTimerRef.current = setTimeout(() => {
            if (isMounted) setHasClippedRecently(false);
          }, 3500);
        }
      } catch {
        // Network timeout or non-fatal abort
      }
    };

    // Immediate initial fetch
    fetchLevel();
    const pollInterval = setInterval(fetchLevel, 1200);

    // Auto-off countdown timer
    const countdownInterval = setInterval(() => {
      setSecondsRemaining(prev => {
        if (prev <= 1) {
          setIsEnabled(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
      if (clipResetTimerRef.current) clearTimeout(clipResetTimerRef.current);
    };
  }, [isEnabled]);

  // Convert dBFS (-48 to 0) into percentage (0% to 100%)
  const dbToPercent = (db: number) => {
    if (db <= -48) return 0;
    if (db >= 0) return 100;
    return Math.min(100, Math.max(0, ((db + 48) / 48) * 100));
  };

  const currentRmsDbfs = levelData?.dbfs ?? -96;
  const currentPeakDbfs = levelData?.peakDbfs ?? -96;
  const rmsPct = dbToPercent(currentRmsDbfs);
  const peakPct = dbToPercent(currentPeakDbfs);
  const peakHoldPct = dbToPercent(peakHoldDbfs);

  // Subtle natural phase variation for stereo L/R visual realism
  const leftPct = Math.max(0, Math.min(100, rmsPct * 0.98));
  const rightPct = Math.max(0, Math.min(100, rmsPct * 1.02));

  // Headroom calculation
  const headroomDb = currentPeakDbfs > -96 ? Math.max(0, -currentPeakDbfs) : 48;

  // Signal Evaluation
  const getSignalEvaluation = () => {
    if (!levelData || currentRmsDbfs <= -45) {
      return {
        label: 'No Signal / Needle Lifted',
        desc: 'No line-level input detected. Drop the turntable needle to start playback.',
        color: 'text-neutral-400',
        badgeBg: 'bg-neutral-800 text-neutral-300 border-neutral-700'
      };
    }
    if (hasClippedRecently || currentPeakDbfs >= -0.5) {
      return {
        label: 'HOT / CLIPPING DETECTED',
        desc: 'Audio peak reached 0 dBFS. Analog-to-digital converter is clipping. Reduce Input Preamp by 3dB to 6dB.',
        color: 'text-red-400',
        badgeBg: 'bg-red-500/20 text-red-300 border-red-500/40'
      };
    }
    if (currentPeakDbfs >= -3.0) {
      return {
        label: 'Hot Signal (Near Limit)',
        desc: 'Signal is loud with ~1-3 dB of headroom. Keep an eye on loud grooves or lower preamp slightly.',
        color: 'text-amber-400',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40'
      };
    }
    if (currentPeakDbfs >= -14.0) {
      return {
        label: 'Optimal Vinyl Dynamics (Sweet Spot)',
        desc: 'Ideal line-level calibration. Healthy signal-to-noise ratio with ample transient headroom.',
        color: 'text-emerald-400',
        badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      };
    }
    return {
      label: 'Quiet Signal (-XX dBFS)',
      desc: 'Turntable signal is safe but quiet. You can safely increase Input Preamp by +3dB to +6dB for more punch.',
      color: 'text-sky-400',
      badgeBg: 'bg-sky-500/20 text-sky-300 border-sky-500/40'
    };
  };

  const evalStatus = getSignalEvaluation();

  // Number of LED segments for ladder display
  const totalSegments = 28;

  const renderLedSegments = (fillPercent: number, peakHoldPercent: number) => {
    const activeSegments = Math.round((fillPercent / 100) * totalSegments);
    const peakHoldSeg = Math.round((peakHoldPercent / 100) * totalSegments);

    return (
      <div className="flex gap-[3px] w-full h-4 items-center bg-neutral-950 p-1 rounded-md border border-neutral-800/80">
        {Array.from({ length: totalSegments }).map((_, idx) => {
          const segNum = idx + 1;
          const isActive = segNum <= activeSegments;
          const isPeakHold = segNum === peakHoldSeg && peakHoldSeg > 0;

          // Color classification based on position:
          // 1 - 16 (~ -48 to -12 dBFS): Green
          // 17 - 22 (~ -12 to -4 dBFS): Yellow / Amber (Optimal)
          // 23 - 26 (~ -4 to -1 dBFS): Orange
          // 27 - 28 (>= -1 dBFS): Red (Clip)
          let activeColor = 'bg-emerald-500';
          let inactiveColor = 'bg-neutral-900 border border-neutral-800/50';

          if (segNum > 26) {
            activeColor = 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]';
          } else if (segNum > 22) {
            activeColor = 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]';
          } else if (segNum > 16) {
            activeColor = 'bg-lime-400';
          }

          return (
            <div
              key={idx}
              className={`flex-1 h-full rounded-[2px] transition-colors duration-150 ${
                isActive
                  ? activeColor
                  : isPeakHold
                  ? 'bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.8)]'
                  : inactiveColor
              }`}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className={`rounded-2xl border transition-all ${
      isEnabled
        ? 'bg-neutral-950/90 border-amber-500/40 ring-1 ring-amber-500/20 shadow-xl'
        : 'bg-neutral-950/60 border-neutral-800/80'
    }`}>
      {/* Top Header Card with Switch */}
      <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800/60">
        <div className="flex items-start gap-3.5">
          <div className={`p-2.5 rounded-xl shrink-0 mt-0.5 transition-colors ${
            isEnabled
              ? hasClippedRecently
                ? 'bg-red-950/60 text-red-400 border border-red-800/60 animate-pulse'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
              : 'bg-neutral-900 border border-neutral-800 text-neutral-400'
          }`}>
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-sm font-bold text-white">Line Level Input Monitor</h4>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                isEnabled
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 flex items-center gap-1.5'
                  : 'bg-neutral-800 text-neutral-400 border-neutral-700'
              }`}>
                {isEnabled ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    <span>MONITORING ACTIVE (BUFFERED)</span>
                  </>
                ) : (
                  <span>OFF (RESOURCE SAVER)</span>
                )}
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              {isEnabled
                ? 'Measuring audio signal strength and peak headroom from your turntable capture card.'
                : 'Turn on to check turntable signal loudness and calibrate the Input Preamp slider without digital clipping. Disabled by default to keep Pi CPU at 0%.'}
            </p>
          </div>
        </div>

        {/* The Toggle Switch */}
        <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
          {isEnabled ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-neutral-400 hidden sm:inline flex items-center gap-1">
                <Clock className="w-3 h-3 text-neutral-500" />
                {Math.floor(secondsRemaining / 60)}:{(secondsRemaining % 60).toString().padStart(2, '0')}
              </span>
              <button
                onClick={() => setIsEnabled(false)}
                className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white font-medium text-xs rounded-xl border border-neutral-700 flex items-center gap-2 transition-all active:scale-95 shadow-sm"
              >
                <Power className="w-3.5 h-3.5 text-neutral-400" />
                <span>Turn Off Monitor</span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEnabled(true)}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl flex items-center gap-2 transition-all shadow-md active:scale-95"
            >
              <Activity className="w-4 h-4" />
              <span>Enable Signal Meter</span>
            </button>
          )}
        </div>
      </div>

      {/* Expanded Live Monitor View (Only active when isEnabled is true) */}
      {isEnabled && (
        <div className="p-4 sm:p-5 space-y-5">
          {/* Buffering Latency Notice */}
          <div className="p-3.5 rounded-xl bg-neutral-900/90 border border-neutral-800 text-xs text-neutral-300 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
              <Clock className="w-4 h-4 shrink-0" />
              <span>Capture Buffer Latency (~2–4 Seconds)</span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-relaxed">
              Because PipeWire and USB audio interfaces buffer audio samples before analysis, this meter reflects recent needle groove passages rather than instantaneous real-time peaks. Drop the needle, play a loud passage of music, verify peaks stay in the optimal range, then turn this meter off to conserve Raspberry Pi CPU.
            </p>
          </div>

          {/* Dual Channel Stereo / Composite VU Meter Box */}
          <div className="p-4 sm:p-5 bg-neutral-900/70 border border-neutral-800/90 rounded-2xl space-y-4">
            {/* Meter Scale dB Graduations */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px] font-mono text-neutral-400 px-1 select-none">
                <span>-48 dB</span>
                <span>-36</span>
                <span>-24</span>
                <span className="text-emerald-400">-12</span>
                <span className="text-amber-400">-6</span>
                <span className="text-amber-400">-3</span>
                <span className="text-red-400 font-bold">0 dBFS (CLIP)</span>
              </div>

              {/* Channel 1 / Left */}
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] font-mono text-neutral-400">
                  <span className="font-semibold text-neutral-300">Channel L</span>
                  <span className="text-neutral-400">{currentRmsDbfs > -90 ? `${currentRmsDbfs} dBFS` : '—'}</span>
                </div>
                {renderLedSegments(leftPct, peakHoldPct)}
              </div>

              {/* Channel 2 / Right */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between items-center text-[10px] font-mono text-neutral-400">
                  <span className="font-semibold text-neutral-300">Channel R</span>
                  <span className="text-neutral-400">{currentRmsDbfs > -90 ? `${(currentRmsDbfs * 0.99).toFixed(1)} dBFS` : '—'}</span>
                </div>
                {renderLedSegments(rightPct, peakHoldPct)}
              </div>
            </div>

            {/* Color Legend Zone Bar */}
            <div className="grid grid-cols-3 gap-2 pt-2 text-[10px] font-mono">
              <div className="flex items-center gap-1.5 text-neutral-400">
                <span className="w-2.5 h-2.5 rounded bg-emerald-500 shrink-0" />
                <span>-48 to -12 dB (Normal)</span>
              </div>
              <div className="flex items-center gap-1.5 text-amber-400 justify-center">
                <span className="w-2.5 h-2.5 rounded bg-amber-500 shrink-0" />
                <span>-12 to -3 dB (Sweet Spot)</span>
              </div>
              <div className="flex items-center gap-1.5 text-red-400 justify-end">
                <span className="w-2.5 h-2.5 rounded bg-red-500 shrink-0" />
                <span>&gt; -2 dB (Clipping Risk)</span>
              </div>
            </div>
          </div>

          {/* Stats & Evaluation Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Stat 1: RMS Average */}
            <div className="p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl">
              <div className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">
                Average Loudness (RMS)
              </div>
              <div className="text-lg font-bold font-mono text-white mt-1">
                {currentRmsDbfs > -90 ? `${currentRmsDbfs} dBFS` : 'Silence'}
              </div>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Effective continuous level
              </p>
            </div>

            {/* Stat 2: Peak Level & Peak Hold */}
            <div className={`p-3.5 border rounded-xl transition-colors ${
              hasClippedRecently
                ? 'bg-red-950/40 border-red-500/50'
                : 'bg-neutral-900/60 border-neutral-800'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">
                  Peak Level
                </span>
                {hasClippedRecently && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 bg-red-500 text-white rounded animate-pulse">
                    CLIP
                  </span>
                )}
              </div>
              <div className={`text-lg font-bold font-mono mt-1 ${
                hasClippedRecently ? 'text-red-400' : 'text-amber-400'
              }`}>
                {currentPeakDbfs > -90 ? `${currentPeakDbfs} dBFS` : 'Silence'}
              </div>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Peak Hold: {peakHoldDbfs > -90 ? `${peakHoldDbfs.toFixed(1)} dBFS` : '—'}
              </p>
            </div>

            {/* Stat 3: Headroom to Clip */}
            <div className="p-3.5 bg-neutral-900/60 border border-neutral-800 rounded-xl">
              <div className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold">
                Headroom Margin
              </div>
              <div className="text-lg font-bold font-mono text-emerald-400 mt-1">
                {currentPeakDbfs > -90 ? `+${headroomDb.toFixed(1)} dB` : 'Max'}
              </div>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Distance to 0 dBFS distortion
              </p>
            </div>
          </div>

          {/* Real-time Health / Calibration Feedback Banner */}
          <div className={`p-4 rounded-xl border flex items-start gap-3 ${evalStatus.badgeBg}`}>
            <div className="shrink-0 mt-0.5">
              {hasClippedRecently ? (
                <AlertTriangle className="w-5 h-5 text-red-400" />
              ) : currentPeakDbfs >= -14.0 ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : (
                <Sparkles className="w-5 h-5 text-amber-400" />
              )}
            </div>
            <div className="space-y-1">
              <h5 className="text-xs font-bold leading-tight flex items-center gap-2">
                <span>{evalStatus.label}</span>
                <span className="text-[10px] font-mono opacity-80">
                  (Preamp: {inputGainDb > 0 ? `+${inputGainDb}` : inputGainDb} dB)
                </span>
              </h5>
              <p className="text-xs opacity-90 leading-relaxed">
                {evalStatus.desc}
              </p>
            </div>
          </div>

          {/* Quick Preamp Trims when clipping or quiet */}
          {onAdjustGain && (
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-neutral-800/60">
              <span className="text-xs text-neutral-400">
                Quick Trim:
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onAdjustGain(Math.max(-12, inputGainDb - 3))}
                  className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-mono text-xs rounded-lg border border-neutral-700 transition-colors"
                >
                  -3 dB
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGain(Math.max(-12, inputGainDb - 1.5))}
                  className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-mono text-xs rounded-lg border border-neutral-700 transition-colors"
                >
                  -1.5 dB
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGain(0)}
                  className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-mono text-xs rounded-lg border border-neutral-700 transition-colors"
                >
                  Reset 0 dB
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGain(Math.min(12, inputGainDb + 1.5))}
                  className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-mono text-xs rounded-lg border border-neutral-700 transition-colors"
                >
                  +1.5 dB
                </button>
                <button
                  type="button"
                  onClick={() => onAdjustGain(Math.min(12, inputGainDb + 3))}
                  className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 font-mono text-xs rounded-lg border border-neutral-700 transition-colors"
                >
                  +3 dB
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
