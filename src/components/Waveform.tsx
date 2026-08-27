"use client";

import { useRef, useEffect, useState } from "react";

interface WaveformProps {
  audioUrl: string | null;
  currentTime: number;
  duration: number;
  onSeek?: (time: number) => void;
}

export default function Waveform({ audioUrl, currentTime, duration, onSeek }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bars, setBars] = useState<number[]>([]);

  useEffect(() => {
    const count = 80;
    const newBars: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = i / count;
      newBars.push(
        0.3 +
          0.7 *
            Math.abs(
              Math.sin(t * 12) *
                Math.cos(t * 7 + 1) *
                Math.sin(t * 19 + 2)
            )
      );
    }
    setBars(newBars);
  }, [audioUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const barWidth = w / bars.length;
    const progress = duration > 0 ? currentTime / duration : 0;

    ctx.clearRect(0, 0, w, h);

    bars.forEach((height, i) => {
      const x = i * barWidth;
      const barH = height * h * 0.8;
      const y = (h - barH) / 2;
      const barProgress = i / bars.length;

      if (barProgress <= progress) {
        const gradient = ctx.createLinearGradient(0, y, 0, y + barH);
        gradient.addColorStop(0, "rgba(251, 191, 36, 0.9)");
        gradient.addColorStop(1, "rgba(251, 191, 36, 0.4)");
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = "rgba(113, 113, 122, 0.3)";
      }

      ctx.fillRect(x + 1, y, Math.max(barWidth - 2, 1), barH);
    });
  }, [bars, currentTime, duration]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !onSeek || duration <= 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    onSeek((x / rect.width) * duration);
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-16 cursor-pointer"
      onClick={handleClick}
    />
  );
}
