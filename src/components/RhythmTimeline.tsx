"use client";

import { useRef, useEffect, useState } from "react";

interface RhythmTimelineProps {
  timestamps: { time: number; chord: string }[];
  duration: number;
  currentTime: number;
  onSeek?: (time: number) => void;
}

export default function RhythmTimeline({
  timestamps,
  duration,
  currentTime,
  onSeek,
}: RhythmTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !onSeek) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    onSeek(pct * duration);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setHoverTime((x / rect.width) * duration);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="rhythm-timeline w-full">
      <div
        ref={containerRef}
        className="relative h-12 bg-zinc-800 rounded-lg cursor-pointer overflow-hidden group"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverTime(null)}
      >
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-500/30 to-amber-400/10 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]"
          style={{ left: `${progress}%` }}
        />

        {timestamps.map((ts, i) => {
          const pos = duration > 0 ? (ts.time / duration) * 100 : 0;
          const isCurrentOrPast = ts.time <= currentTime;
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px"
              style={{ left: `${pos}%` }}
            >
              <div
                className={`absolute bottom-0 left-0 right-0 ${
                  isCurrentOrPast ? "bg-amber-400" : "bg-zinc-600"
                }`}
                style={{ height: "40%" }}
              />
              <div
                className={`absolute bottom-0 text-[9px] font-mono whitespace-nowrap px-0.5 -translate-x-1/2 ${
                  isCurrentOrPast ? "text-amber-400" : "text-zinc-500"
                }`}
              >
                {ts.chord}
              </div>
            </div>
          );
        })}

        {hoverTime !== null && (
          <div className="absolute -top-6 text-xs text-zinc-400 font-mono -translate-x-1/2 pointer-events-none" style={{ left: `${(hoverTime / duration) * 100}%` }}>
            {formatTime(hoverTime)}
          </div>
        )}
      </div>

      <div className="flex justify-between mt-1 text-xs text-zinc-500 font-mono">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
