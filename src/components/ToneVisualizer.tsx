import React, { useMemo } from 'react';

interface ToneVisualizerProps {
  bassDb: number;
  midDb?: number;
  trebleDb: number;
  gainDb: number;
}

export const ToneVisualizer: React.FC<ToneVisualizerProps> = ({
  bassDb,
  midDb = 0,
  trebleDb,
  gainDb
}) => {
  // SVG coordinate dimensions
  const svgWidth = 1000;
  const svgHeight = 84;
  const centerY = svgHeight / 2;
  const maxDbRange = 24; // +/- 24dB display bounds
  const scaleY = (svgHeight / 2) / maxDbRange;

  // Logarithmic calculation from 20Hz to 20,000Hz (3 decades)
  // log10(20) = 1.3010, log10(20000) = 4.3010, range = 3.0000
  const { pathD, fillD } = useMemo(() => {
    const numPoints = 80;
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i <= numPoints; i++) {
      const frac = i / numPoints; // 0.0 to 1.0
      const logFreq = 1.30103 + frac * 3.0;
      const freq = Math.pow(10, logFreq);

      // 1. Low shelf response (100 Hz cutoff)
      const bassRatio = freq / 100;
      const bassResponse = bassDb / (1 + Math.pow(bassRatio, 2));

      // 2. Mid peaking filter (1000 Hz bell, Q ~ 1.0)
      const midOctaves = Math.log10(freq / 1000) / 0.35;
      const midResponse = midDb / (1 + Math.pow(midOctaves, 2));

      // 3. High shelf response (10000 Hz cutoff)
      const trebleRatio = freq / 10000;
      const trebleResponse = (trebleDb * Math.pow(trebleRatio, 2)) / (1 + Math.pow(trebleRatio, 2));

      // Total dB response at this frequency
      const totalDb = gainDb + bassResponse + midResponse + trebleResponse;

      // Clamp visually to avoid drawing outside SVG
      const clampedDb = Math.max(-22, Math.min(22, totalDb));
      const x = frac * svgWidth;
      const y = centerY - clampedDb * scaleY;

      points.push({ x, y });
    }

    const strokePath = points.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x.toFixed(1)},${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }, '');

    const areaPath = `${strokePath} L ${svgWidth},${svgHeight} L 0,${svgHeight} Z`;

    return { pathD: strokePath, fillD: areaPath };
  }, [bassDb, midDb, trebleDb, gainDb, scaleY, centerY]);

  return (
    <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 flex flex-col items-center shadow-lg">
      {/* Dynamic Logarithmic Frequency Axis Labels */}
      <div className="relative w-full h-5 text-[11px] font-mono text-neutral-400 mb-2">
        <div className="absolute left-0 -translate-x-0">
          <span className="text-neutral-500">20Hz</span>
        </div>

        <div className="absolute left-[23.3%] -translate-x-1/2 text-center whitespace-nowrap">
          <span className="font-semibold text-amber-400">
            100Hz (Bass {bassDb > 0 ? `+${bassDb}` : bassDb}dB)
          </span>
        </div>

        <div className="absolute left-[56.6%] -translate-x-1/2 text-center whitespace-nowrap">
          <span className="font-semibold text-emerald-400">
            1kHz (Mid {midDb > 0 ? `+${midDb}` : midDb}dB)
          </span>
        </div>

        <div className="absolute left-[90.0%] -translate-x-1/2 text-center whitespace-nowrap">
          <span className="font-semibold text-sky-400">
            10kHz (Treble {trebleDb > 0 ? `+${trebleDb}` : trebleDb}dB)
          </span>
        </div>
      </div>

      {/* SVG Canvas with Gridlines & Response Curve */}
      <div className="relative w-full h-24 bg-neutral-950/90 rounded-xl overflow-hidden border border-neutral-800/80 shadow-inner">
        {/* Horizontal dB reference lines */}
        <div className="absolute w-full h-[1px] bg-neutral-800/80 top-[50%] pointer-events-none" />
        <div className="absolute w-full h-[1px] bg-neutral-800/30 top-[25%] pointer-events-none" />
        <div className="absolute w-full h-[1px] bg-neutral-800/30 bottom-[25%] pointer-events-none" />

        {/* Vertical frequency alignment guide lines */}
        <div className="absolute top-0 bottom-0 left-[23.3%] w-[1px] bg-amber-500/15 pointer-events-none" />
        <div className="absolute top-0 bottom-0 left-[56.6%] w-[1px] bg-emerald-500/15 pointer-events-none" />
        <div className="absolute top-0 bottom-0 left-[90.0%] w-[1px] bg-sky-500/15 pointer-events-none" />

        {/* dB labels */}
        <div className="absolute left-2 top-1 text-[9px] font-mono text-neutral-600 pointer-events-none">
          +12dB
        </div>
        <div className="absolute left-2 top-[44%] text-[9px] font-mono text-neutral-500 pointer-events-none">
          0dB
        </div>
        <div className="absolute left-2 bottom-1 text-[9px] font-mono text-neutral-600 pointer-events-none">
          -12dB
        </div>

        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="none"
          className="w-full h-full block overflow-visible"
        >
          <defs>
            <linearGradient id="eqResponseGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.9" />
              <stop offset="25%" stopColor="#f59e0b" stopOpacity="0.95" />
              <stop offset="56%" stopColor="#10b981" stopOpacity="0.95" />
              <stop offset="90%" stopColor="#38bdf8" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="eqAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.28" />
              <stop offset="50%" stopColor="#10b981" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#0a0a0a" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Under curve shaded glow */}
          <path d={fillD} fill="url(#eqAreaGrad)" />

          {/* Frequency response stroke line */}
          <path
            d={pathD}
            fill="none"
            stroke="url(#eqResponseGrad)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Footer Details */}
      <div className="w-full flex items-center justify-between text-[11px] text-neutral-400 font-mono mt-2 px-1">
        <span>
          Input Preamp: <span className="text-amber-400 font-semibold">{gainDb > 0 ? `+${gainDb}` : gainDb} dB</span>
        </span>
        <span className="text-neutral-500">PipeWire 3-Band Parametric DSP (Zero Latency)</span>
      </div>
    </div>
  );
};
