export interface BpmResult {
  bpm: number;
  confidence: number;
}

const TARGET_SAMPLE_RATE = 11025;
const FRAME_SECONDS = 0.05;
const MIN_BPM = 60;
const MAX_BPM = 180;

function toMonoLowpass(buffer: AudioBuffer, maxSeconds: number): Float32Array {
  const srcRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const mono = channels > 1 || buffer.getChannelData(0).some((v) => v !== buffer.getChannelData(1)[0])
    ? channels >= 2
    : false;

  const b0 = buffer.getChannelData(0);
  const b1 = mono ? buffer.getChannelData(1) : b0;

  const windowLen = Math.min(b0.length, Math.floor(maxSeconds * srcRate));
  const step = 2;
  const outLength = Math.floor(windowLen / step);

  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const s = i * step;
    out[i] = (b0[s] + b1[s]) * 0.5;
  }
  return out;
}

function onsetEnvelope(mono: Float32Array): Float32Array {
  const frame = Math.floor(TARGET_SAMPLE_RATE * FRAME_SECONDS);
  const count = Math.floor(mono.length / frame);
  const env = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const off = i * frame;
    let acc = 0;
    for (let j = 0; j < frame; j++) {
      const v = mono[off + j];
      acc += v * v;
    }
    env[i] = Math.sqrt(acc / frame);
  }
  const diff = new Float32Array(count - 1);
  for (let i = 0; i < diff.length; i++) {
    diff[i] = Math.max(0, env[i + 1] - env[i]);
  }
  return diff;
}

export function analyzeBpm(buffer: AudioBuffer, maxSeconds = 60): BpmResult {
  const mono = toMonoLowpass(buffer, maxSeconds);
  const diff = onsetEnvelope(mono);

  const hopSec = FRAME_SECONDS;
  const minLag = Math.max(2, Math.floor((60 / MAX_BPM) / hopSec) - 1);
  const maxLag = Math.ceil((60 / MIN_BPM) / hopSec) + 1;

  let bestLag = 0;
  let bestScore = -Infinity;
  const scores = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    let energyA = 0;
    let energyB = 0;
    for (let i = 0; i + lag < diff.length; i++) {
      const a = diff[i];
      const b = diff[i + lag];
      s += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const score = s / (Math.sqrt(energyA * energyB) || 1);
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag <= 0 || !isFinite(bestScore)) {
    return { bpm: 0, confidence: 0 };
  }

  let refined = bestLag;
  const a = scores[bestLag - 1] ?? 0;
  const b = scores[bestLag];
  const c = scores[bestLag + 1] ?? 0;
  const denom = a - 2 * b + c;
  if (Math.abs(denom) > 1e-9) {
    refined += (a - c) / (2 * denom);
  }

  const bpm = 60 / (refined * hopSec);
  return { bpm, confidence: bestScore };
}

export async function detectBpmFromFile(file: File, maxSeconds = 60): Promise<BpmResult> {
  const buf = await file.arrayBuffer();
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("Web Audio non supporté");
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    const result = analyzeBpm(decoded, maxSeconds);
    await ctx.close();
    return result;
  } catch (err) {
    await ctx.close().catch(() => {});
    throw err;
  }
}