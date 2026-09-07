import React, { useState, useEffect, useRef } from 'react';
import { Moon } from 'lucide-react';

interface ScreenDimmerProps {
  dimMinutes: number;
  lastActivityTimestamp: number;
  currentTrackKey: string;
  onWake: () => void;
}

export const ScreenDimmer: React.FC<ScreenDimmerProps> = ({
  dimMinutes,
  lastActivityTimestamp,
  currentTrackKey,
  onWake
}) => {
  const [isDimmed, setIsDimmed] = useState(false);
  const prevTrackKeyRef = useRef(currentTrackKey);

  // Wake on new track detection / needle drop
  useEffect(() => {
    if (prevTrackKeyRef.current !== currentTrackKey) {
      prevTrackKeyRef.current = currentTrackKey;
      if (isDimmed) {
        setIsDimmed(false);
        onWake();
      }
    }
  }, [currentTrackKey, isDimmed, onWake]);

  useEffect(() => {
    if (dimMinutes <= 0) {
      setIsDimmed(false);
      return;
    }

    const checkInterval = setInterval(() => {
      const elapsedMs = Date.now() - lastActivityTimestamp;
      const thresholdMs = dimMinutes * 60 * 1000;

      if (elapsedMs >= thresholdMs && !isDimmed) {
        setIsDimmed(true);
      }
    }, 1000);

    return () => clearInterval(checkInterval);
  }, [dimMinutes, lastActivityTimestamp, isDimmed]);

  if (!isDimmed) return null;

  return (
    <div
      onClick={() => {
        setIsDimmed(false);
        onWake();
      }}
      className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center cursor-pointer select-none transition-opacity duration-1000 animate-in fade-in"
      style={{ touchAction: 'none' }}
    >
      <div className="flex flex-col items-center gap-3 opacity-30 hover:opacity-75 transition-opacity">
        <div className="w-12 h-12 rounded-full border border-neutral-800 flex items-center justify-center text-neutral-500">
          <Moon className="w-5 h-5 animate-pulse" />
        </div>
        <p className="text-xs font-mono text-neutral-500 tracking-wider">
          OLED Burn-in Protection Active • Tap anywhere to wake
        </p>
      </div>
    </div>
  );
};
