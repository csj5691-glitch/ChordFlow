# -*- coding: utf-8 -*-
# Copyright (c) 2026 Claude St-Jean. All rights reserved.
"""Service local de transcription audio -> tablature / accords.

Trois axes :
  * notes   : YIN vectorise (FFT) + detection d'attaques -> tablature ASCII ;
  * accords : chroma + templates, tonalite estimee, lissage temporel ;
  * suivi   : /progress permet a l'interface d'afficher une vraie barre.
"""

import math
import os
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from scipy import signal as sp_signal
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="ChordFlow Transcribe Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# --------------------------------------------------------------------------- #
# Progression partagee entre les routes (lue par /progress)
# --------------------------------------------------------------------------- #

PROGRESS: dict = {}
PROGRESS_TTL = 900.0


def set_progress(token: str, state: str, percent: float, line: str) -> None:
    if not token:
        return
    now = time.time()
    for key in [k for k, v in PROGRESS.items() if now - v["t"] > PROGRESS_TTL]:
        PROGRESS.pop(key, None)
    PROGRESS[token] = {
        "state": state,
        "percent": max(0.0, min(100.0, round(float(percent), 1))),
        "line": line,
        "t": now,
    }


@app.get("/health")
def health():
    return {"ok": True, "service": "transcribe", "version": "0.2"}


@app.get("/progress")
def progress(token: str = ""):
    entry = PROGRESS.get(token)
    if entry is None:
        raise HTTPException(404, "aucune progression")
    return {
        "ok": True,
        "state": entry["state"],
        "percent": entry["percent"],
        "line": entry["line"],
    }


# --------------------------------------------------------------------------- #
# Outils audio
# --------------------------------------------------------------------------- #


def load_mono(path: str):
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = np.ascontiguousarray(audio, dtype=np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio / peak
    return audio, sr


def frame_rms(audio: np.ndarray, frame_size: int, hop: int, n_frames: int) -> np.ndarray:
    squares = np.concatenate([[0.0], np.cumsum(audio.astype(np.float64) ** 2)])
    starts = np.arange(n_frames) * hop
    sums = squares[starts + frame_size] - squares[starts]
    return np.sqrt(np.maximum(sums, 0.0) / frame_size)


def onset_strength(
    audio: np.ndarray, sr: int, frame_size: int, hop: int, n_frames: int
) -> np.ndarray:
    """Flux spectral aligne sur la grille de YIN (meme debut, meme saut)."""
    if n_frames <= 1:
        return np.zeros(max(n_frames, 0))
    _, _, zxx = sp_signal.stft(
        audio,
        fs=sr,
        nperseg=frame_size,
        noverlap=frame_size - hop,
        window="hann",
        boundary=None,
        padded=False,
    )
    mag = np.abs(zxx)
    if mag.shape[1] < n_frames:
        pad = n_frames - mag.shape[1]
        mag = np.pad(mag, ((0, 0), (0, pad)))
    mag = mag[:, :n_frames]
    diff = np.diff(mag, axis=1, prepend=mag[:, :1])
    flux = np.sum(np.maximum(diff, 0.0), axis=0)
    ref = float(np.median(flux)) if flux.size else 0.0
    return flux / (ref + 1e-9)


# --------------------------------------------------------------------------- #
# Detection de hauteur (YIN vectorise)
# --------------------------------------------------------------------------- #


def yin_pitch(
    audio: np.ndarray,
    sr: int,
    frame_size: int = 2048,
    hop: int = 512,
    threshold: float = 0.15,
    fmin: float = 55.0,
    fmax: float = 1800.0,
    progress=None,
):
    """YIN par autocorrelation FFT. Retourne (times, freqs, probs)."""
    n = len(audio)
    if n < frame_size:
        empty = np.zeros(0)
        return empty, empty, empty

    n_frames = 1 + (n - frame_size) // hop
    tau_min = max(2, int(math.floor(sr / fmax)))
    tau_max = min(frame_size // 2, int(math.ceil(sr / fmin)))
    nfft = 1 << int(2 * frame_size - 1).bit_length()

    times = (np.arange(n_frames) * hop + frame_size / 2.0) / sr
    freqs = np.zeros(n_frames)
    probs = np.zeros(n_frames)

    taus = np.arange(0, tau_max + 1)
    chunk = 256
    for c0 in range(0, n_frames, chunk):
        c1 = min(n_frames, c0 + chunk)
        rows = c1 - c0
        idx = np.arange(c0, c1)[:, None] * hop + np.arange(frame_size)[None, :]
        frames = audio[idx].astype(np.float64)

        spec = np.fft.rfft(frames, nfft, axis=1)
        acf = np.fft.irfft(spec * np.conj(spec), nfft, axis=1)[:, : tau_max + 1]

        sq = np.cumsum(frames * frames, axis=1)
        pre = np.concatenate([np.zeros((rows, 1)), sq], axis=1)
        total = sq[:, -1:]
        d = pre[:, frame_size - taus] + (total - pre[:, taus]) - 2.0 * acf
        np.maximum(d, 0.0, out=d)
        d[:, 0] = 0.0

        cum = np.cumsum(d[:, 1:], axis=1)
        with np.errstate(divide="ignore", invalid="ignore"):
            dn = d[:, 1:] * np.arange(1, tau_max + 1) / cum
        dn = np.nan_to_num(dn, nan=1.0, posinf=1.0)

        for r in range(rows):
            row = dn[r]
            lo = tau_min - 1
            hi = min(tau_max, row.size)
            if hi <= lo:
                continue
            below = np.nonzero(row[lo:hi] < threshold)[0]
            if below.size == 0:
                continue
            ti = lo + int(below[0])
            stop = min(row.size, ti + 12)
            if stop > ti:
                ti += int(np.argmin(row[ti:stop]))
            tau = ti + 1
            delta = 0.0
            if 1 <= ti and ti + 1 < row.size:
                a, b, c = row[ti - 1], row[ti], row[ti + 1]
                den = a - 2.0 * b + c
                if abs(den) > 1e-12:
                    delta = max(-0.5, min(0.5, 0.5 * (a - c) / den))
            period = tau + delta
            if period <= 0:
                continue
            freq = sr / period
            if fmin <= freq <= fmax:
                freqs[c0 + r] = freq
                probs[c0 + r] = max(0.0, min(1.0, 1.0 - row[ti]))

        if progress is not None:
            progress(c1 / n_frames)

    return times, freqs, probs


def midi_from_freq(freq: float) -> int:
    if freq <= 0:
        return 0
    return int(round(69 + 12 * math.log2(freq / 440.0)))


def freq_to_note_name(midi: int) -> str:
    if midi <= 0:
        return "R"
    return f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}"


def fold_to_guitar(midi: int) -> int:
    """Ramene la hauteur dans la tessiture de la guitare (cordes a vide a 83)."""
    while midi < 40:
        midi += 12
    while midi > 83:
        midi -= 12
    return midi


def guitar_string_fret(midi: int):
    """Mappe une note MIDI sur la corde/case la plus basse jouable."""
    open_strings = [40, 45, 50, 55, 59, 64]  # corde 6..1 (E2 -> E4)
    best = None
    for si, open_midi in enumerate(open_strings):
        fret = midi - open_midi
        if 0 <= fret <= 19:
            if best is None or fret < best[1]:
                best = (6 - si, fret)
    if best is None:
        return (None, None)
    return best


def _spectral_peaks(row: np.ndarray, bin_hz: float, fmin: float, fmax: float) -> list:
    """Pics spectraux (frequence, amplitude) d'une trame, hors harmoniques."""
    lo = int(fmin / bin_hz)
    hi = min(len(row) - 1, int(fmax / bin_hz))
    if hi - lo < 3:
        return []
    seg = row[lo:hi]
    if seg.size == 0:
        return []
    peak_mask = (seg[1:-1] > seg[:-2]) & (seg[1:-1] >= seg[2:])
    idx = np.nonzero(peak_mask)[0] + 1
    if idx.size == 0:
        return []
    amps = seg[idx]
    order = np.argsort(amps)[::-1]
    peaks = []
    for k in order:
        i = int(idx[k])
        a, b, c = seg[i - 1], seg[i], seg[i + 1]
        den = a - 2.0 * b + c
        delta = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
        delta = max(-0.5, min(0.5, delta))
        peaks.append((float((lo + i + delta) * bin_hz), float(b)))
    return peaks


def _harmonic_salience(row: np.ndarray, bin_hz: float, freq: float, harmonics: int = 6) -> float:
    total = 0.0
    for h in range(1, harmonics + 1):
        fh = freq * h
        b = int(round(fh / bin_hz))
        if b + 2 >= len(row):
            break
        lo = max(0, b - 2)
        total += float(row[lo:b + 3].max()) / h
    return total


def _notes_spectral(
    audio: np.ndarray,
    sr: int,
    progress=None,
    max_voices: int = 2,
    min_dur: float = 0.10,
    amp_floor: float = 0.12,
    sal_floor: float = 0.35,
) -> list:
    """Transcription polyphonique legere : pics spectraux + salience harmonique."""
    frame_size, hop = 4096, 512
    n = len(audio)
    if n < frame_size:
        return []

    nfft = 1 << int(2 * frame_size - 1).bit_length()
    bin_hz = sr / nfft
    n_frames = 1 + (n - frame_size) // hop
    window = sp_signal.get_window("hann", frame_size).astype(np.float64)
    times = (np.arange(n_frames) * hop + frame_size / 2.0) / sr

    rms = frame_rms(audio, frame_size, hop, n_frames)
    gate = max(1e-4, float(np.percentile(rms, 90)) * 0.06)

    # Flux spectral pour couper les notes repetees sur la meme hauteur.
    flux = onset_strength(audio, sr, frame_size, hop, n_frames)
    onset_thr = float(np.mean(flux) + 1.0 * np.std(flux))

    fmin, fmax = 65.0, 1500.0
    active: dict = {}
    notes = []
    chunk = 128

    for c0 in range(0, n_frames, chunk):
        c1 = min(n_frames, c0 + chunk)
        idx = np.arange(c0, c1)[:, None] * hop + np.arange(frame_size)[None, :]
        frames = audio[idx].astype(np.float64) * window
        mag = np.abs(np.fft.rfft(frames, nfft, axis=1))

        for r in range(c1 - c0):
            i = c0 + r
            if rms[i] < gate:
                present = set()
            else:
                row = mag[r]
                peaks = _spectral_peaks(row, bin_hz, fmin, fmax)
                if not peaks:
                    present = set()
                else:
                    top_amp = peaks[0][1]
                    scored = []
                    for freq, amp in peaks[:24]:
                        if amp < amp_floor * top_amp:
                            continue
                        scored.append((_harmonic_salience(row, bin_hz, freq), freq))
                    scored.sort(reverse=True)
                    present = set()
                    chosen = []
                    if scored:
                        best_sal = scored[0][0]
                        for sal, freq in scored:
                            if len(chosen) >= max_voices:
                                break
                            if sal < sal_floor * best_sal:
                                continue
                            # Ecarte les harmoniques d'une fondamentale deja retenue.
                            harmonic = False
                            for base in chosen:
                                if freq > base * 1.5 and abs(freq / base - round(freq / base)) < 0.04:
                                    harmonic = True
                                    break
                            if harmonic:
                                continue
                            chosen.append(freq)
                            present.add(fold_to_guitar(midi_from_freq(freq)))

            # Notes presentes : prolonge, coupe ou demarre.
            for midi in list(active):
                if midi in present:
                    if flux[i] >= onset_thr and times[i] - active[midi]["start"] >= 0.16:
                        active[midi]["end"] = float(times[i])
                        notes.append(active[midi])
                        active[midi] = {
                            "start": float(times[i]),
                            "end": float(times[i]),
                            "midi": midi,
                            "prob": 0.6,
                            "last": i,
                        }
                    else:
                        active[midi]["end"] = float(times[i])
                        active[midi]["last"] = i
                elif i - active[midi]["last"] > 2:
                    notes.append(active.pop(midi))
            for midi in present:
                if midi not in active:
                    active[midi] = {
                        "start": float(times[i]),
                        "end": float(times[i]),
                        "midi": midi,
                        "prob": 0.6,
                        "last": i,
                    }

        if progress is not None:
            progress(c1 / n_frames)

    notes.extend(active.values())
    notes.sort(key=lambda n: n["start"])
    return [n for n in notes if n["end"] - n["start"] >= min_dur]


def _notes_yin(audio: np.ndarray, sr: int, progress=None) -> list:
    """Repli monophonique (YIN) quand l'analyse spectrale ne trouve presque rien."""
    frame_size, hop = 2048, 512
    n = len(audio)
    if n < frame_size:
        return []

    times, freqs, probs = yin_pitch(audio, sr, frame_size=frame_size, hop=hop)
    n_frames = len(times)
    rms = frame_rms(audio, frame_size, hop, n_frames)
    gate = max(1e-4, float(np.percentile(rms, 90)) * 0.07)

    notes = []
    cur = None
    for i in range(n_frames):
        voiced = probs[i] >= 0.40 and 55.0 <= freqs[i] <= 1800.0 and rms[i] >= gate
        if voiced:
            midi = fold_to_guitar(midi_from_freq(freqs[i]))
            if cur is None:
                cur = {"start": float(times[i]), "end": float(times[i]), "midi": midi, "prob": float(probs[i])}
            elif midi == cur["midi"]:
                cur["end"] = float(times[i])
            else:
                notes.append(cur)
                cur = {"start": float(times[i]), "end": float(times[i]), "midi": midi, "prob": float(probs[i])}
        elif cur is not None and times[i] - cur["end"] > 0.08:
            notes.append(cur)
            cur = None
    if cur is not None:
        notes.append(cur)
    if progress is not None:
        progress(1.0)
    return [n for n in notes if n["end"] - n["start"] >= 0.08]


def detect_notes(audio: np.ndarray, sr: int, progress=None) -> list:
    notes = _notes_spectral(audio, sr, progress, max_voices=2, min_dur=0.16)
    if len(notes) < 20:
        mono = _notes_yin(audio, sr, progress)
        if len(mono) > len(notes):
            notes = mono
    if progress:
        progress(1.0)

    # Mappage guitare + une seule note par corde et par colonne de tablature.
    notes.sort(key=lambda n: n["start"])
    occupied = set()
    out = []
    for note in notes:
        s, f = guitar_string_fret(note["midi"])
        if s is None:
            continue
        col = int(note["start"] / 0.125)
        if (s, col) in occupied:
            continue
        occupied.add((s, col))
        note["string"] = s
        note["fret"] = f
        note["note"] = freq_to_note_name(note["midi"])
        out.append(note)
    return out


def _generate_tab(notes: list, col_width: float = 0.25, cols_per_line: int = 32) -> str:
    """Tablature ASCII, decoupee en systemes lisibles."""
    if not notes:
        return ""

    max_time = max((n["end"] for n in notes), default=0.0)
    num_cols = max(1, int(max_time / col_width) + 1)
    grid = {s: ["-"] * (num_cols * 2) for s in range(1, 7)}

    for note in notes:
        s = note.get("string")
        f = note.get("fret")
        if s is None or f is None:
            continue
        col = int(note["start"] / col_width)
        pos = col * 2
        text = str(f)
        if pos + len(text) > num_cols * 2:
            continue
        if any(ch != "-" for ch in grid[s][pos:pos + len(text)]):
            continue
        for ci, ch in enumerate(text):
            grid[s][pos + ci] = ch

    labels = {1: "e", 2: "B", 3: "G", 4: "D", 5: "A", 6: "E"}
    width = cols_per_line * 2
    systems = []
    for start in range(0, num_cols * 2, width):
        block = []
        for s in range(1, 7):
            chunk = "".join(grid[s][start:start + width])
            block.append(f"{labels[s]}|{chunk}|")
        systems.append("\n".join(block))
    return "\n\n".join(systems)


# --------------------------------------------------------------------------- #
# Accords : chroma + templates + tonalite
# --------------------------------------------------------------------------- #

CHORD_TEMPLATES = {}

# Triades
for r in range(12):
    for name, offsets in (
        ("", (0, 4, 7)),
        ("m", (0, 3, 7)),
        ("7", (0, 4, 7, 10)),
        ("maj7", (0, 4, 7, 11)),
        ("m7", (0, 3, 7, 10)),
        ("sus2", (0, 2, 7)),
        ("sus4", (0, 5, 7)),
    ):
        v = np.zeros(12)
        for off in offsets:
            v[(r + off) % 12] = 1.0
        CHORD_TEMPLATES[f"{NOTE_NAMES[r]}{name}"] = v

for key in CHORD_TEMPLATES:
    norm = np.linalg.norm(CHORD_TEMPLATES[key])
    if norm > 0:
        CHORD_TEMPLATES[key] = CHORD_TEMPLATES[key] / norm

CHORD_NAMES_LIST = list(CHORD_TEMPLATES.keys())
CHORD_MATRIX = np.array([CHORD_TEMPLATES[k] for k in CHORD_NAMES_LIST])


def chord_prior(name: str) -> float:
    """Favorise les triades, penalise les couleurs rarement justes."""
    if name.endswith("sus2") or name.endswith("sus4"):
        return -0.12
    if name.endswith("maj7") or name.endswith("m7"):
        return -0.05
    if name.endswith("7"):
        return -0.03
    return 0.06


CHORD_PRIORS = np.array([chord_prior(name) for name in CHORD_NAMES_LIST])

MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
KRUMHANSL_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KRUMHANSL_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def compute_chroma(audio: np.ndarray, sr: int, frame_size: int = 4096, hop: int = 2048):
    freqs, times, zxx = sp_signal.stft(
        audio,
        fs=sr,
        nperseg=frame_size,
        noverlap=frame_size - hop,
        window="hann",
        boundary=None,
        padded=False,
    )
    mag = np.abs(zxx)
    keep = (freqs >= 65) & (freqs <= 2100)
    freqs = freqs[keep]
    mag = mag[keep]
    if freqs.size == 0 or mag.shape[1] == 0:
        return np.zeros((12, 0)), times

    midi = 69 + 12 * np.log2(freqs / 440.0)
    pc = midi % 12.0
    lower = np.floor(pc).astype(int) % 12
    frac = pc - np.floor(pc)

    chroma = np.zeros((12, mag.shape[1]))
    for k in range(12):
        weight = np.where(lower == k, 1.0 - frac, 0.0)
        weight += np.where((lower + 1) % 12 == k, frac, 0.0)
        if np.any(weight):
            chroma[k] = (mag * weight[:, None]).sum(axis=0)

    chroma = sp_signal.convolve(chroma, np.ones((1, 5)) / 5.0, mode="same")
    norm = np.linalg.norm(chroma, axis=0)
    norm[norm == 0] = 1.0
    return chroma / norm, times


def detect_key(chroma: np.ndarray):
    if chroma.shape[1] == 0:
        return 0, "maj"
    avg = chroma.mean(axis=1)
    best = (-1e9, 0, "maj")
    for root in range(12):
        for profile, mode in ((KRUMHANSL_MAJOR, "maj"), (KRUMHANSL_MINOR, "min")):
            score = float(np.dot(avg, np.roll(profile, root)))
            if score > best[0]:
                best = (score, root, mode)
    return best[1], best[2]


def diatonic_chords(root: int, mode: str) -> set:
    scale = MAJOR_SCALE if mode == "maj" else MINOR_SCALE
    qualities = ["", "m", "m", "", "", "m", "dim"] if mode == "maj" else ["m", "dim", "", "m", "m", "", ""]
    out = set()
    for degree in range(7):
        pc = (root + scale[degree]) % 12
        out.add(f"{NOTE_NAMES[pc]}{qualities[degree]}")
    return out


def detect_chords(audio: np.ndarray, sr: int, progress=None) -> tuple:
    chroma, times = compute_chroma(audio, sr)
    n_frames = chroma.shape[1]
    if n_frames == 0:
        return [], 0, "maj"

    root, mode = detect_key(chroma)
    key_name = f"{NOTE_NAMES[root]}{'' if mode == 'maj' else 'm'}"
    allowed = diatonic_chords(root, mode)
    bonus = np.array([0.09 if name in allowed else 0.0 for name in CHORD_NAMES_LIST])
    if progress:
        progress(0.35)

    scores = CHORD_MATRIX @ chroma + (CHORD_PRIORS + bonus)[:, None]
    scores = sp_signal.convolve(scores, np.ones((1, 5)) / 5.0, mode="same")
    if progress:
        progress(0.6)

    rms = frame_rms(audio, 4096, 2048, n_frames)
    gate = max(1e-4, float(np.percentile(rms, 90)) * 0.06)

    best_idx = np.argmax(scores, axis=0)
    best_score = np.max(scores, axis=0)
    seq = []
    for j in range(n_frames):
        if rms[j] < gate or best_score[j] < 0.25:
            seq.append(None)
        else:
            seq.append(CHORD_NAMES_LIST[best_idx[j]])
    if progress:
        progress(0.75)

    # Segments bruts
    segments = []
    current = seq[0]
    start = 0
    for j in range(1, n_frames):
        if seq[j] != current:
            segments.append([start, j - 1, current])
            current = seq[j]
            start = j
    segments.append([start, n_frames - 1, current])

    frame_dt = float(times[1] - times[0]) if n_frames > 1 else 0.05
    min_frames = max(1, int(round(0.45 / frame_dt)))

    # Absorbe les segments trop courts dans leur voisin le plus credible
    for i, seg in enumerate(segments):
        if seg[2] is None or (seg[1] - seg[0] + 1) >= min_frames:
            continue
        prev_c = segments[i - 1][2] if i > 0 else None
        next_c = segments[i + 1][2] if i + 1 < len(segments) else None
        if prev_c is None and next_c is None:
            seg[2] = None
        elif prev_c is None:
            seg[2] = next_c
        elif next_c is None:
            seg[2] = prev_c
        else:
            seg[2] = prev_c if (seg[1] - seg[0] + 1) < min_frames / 2 else next_c

    # Fusionne les voisins identiques
    merged = []
    for seg in segments:
        if merged and merged[-1][2] == seg[2]:
            merged[-1][1] = seg[1]
        else:
            merged.append(seg)

    duration = len(audio) / sr
    result = []
    for i, (s, e, name) in enumerate(merged):
        if name is None:
            continue
        t_start = float(times[s])
        t_end = float(times[merged[i + 1][0]]) if i + 1 < len(merged) else float(duration)
        if t_end - t_start < 0.2:
            continue
        result.append({"start": round(t_start, 2), "end": round(t_end, 2), "chord": name})

    if progress:
        progress(1.0)
    return result, key_name, mode


# --------------------------------------------------------------------------- #
# Repetitions
# --------------------------------------------------------------------------- #


def detect_repetitions(sequence: list, min_pattern: int = 3, min_repeats: int = 2) -> dict:
    """Plus long passage d'accords qui revient au moins deux fois (LRS)."""
    n = len(sequence)
    empty = {"pattern": [], "repeats": 0, "positions": [], "coverage": 0.0}
    if n < min_pattern * min_repeats:
        return empty

    # Programmation dynamique : L[i][j] = longueur du plus long prefixe commun
    # a partir de i et j (i < j).
    best_len = 0
    best_i = 0
    best_j = 0
    prev = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        cur = [0] * (n + 1)
        for j in range(n - 1, i, -1):
            if sequence[i] == sequence[j]:
                cur[j] = prev[j + 1] + 1
                length = cur[j]
                if length >= min_pattern and length <= j - i and length > best_len:
                    best_len = length
                    best_i = i
                    best_j = j
        prev = cur

    if best_len == 0:
        return empty

    pattern = sequence[best_i:best_i + best_len]
    positions = []
    pos = 0
    while pos + best_len <= n:
        if sequence[pos:pos + best_len] == pattern:
            positions.append(pos)
            pos += best_len
        else:
            pos += 1

    return {
        "pattern": pattern,
        "repeats": len(positions),
        "positions": positions,
        "coverage": round((len(positions) * best_len) / n, 3),
    }


def detect_all_patterns(sequence: list, min_pattern: int = 2, min_repeats: int = 2) -> list:
    n = len(sequence)
    results = []
    seen = set()
    for pat_len in range(2, n // 2 + 1):
        for start in range(0, n - pat_len * min_repeats + 1):
            pattern = tuple(sequence[start:start + pat_len])
            if pattern in seen:
                continue
            pos = start
            repeats = 0
            positions = []
            while pos + pat_len <= n and tuple(sequence[pos:pos + pat_len]) == pattern:
                repeats += 1
                positions.append(pos)
                pos += pat_len
            if repeats >= min_repeats:
                seen.add(pattern)
                results.append(
                    {
                        "pattern": list(pattern),
                        "repeats": repeats,
                        "positions": positions,
                        "coverage": round((repeats * pat_len) / n, 3),
                    }
                )
    results.sort(key=lambda r: r["coverage"], reverse=True)
    return results


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


def _read_upload(path: str):
    return load_mono(path)


def _run_transcribe(data: bytes, suffix: str, token: str) -> dict:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    try:
        set_progress(token, "running", 3, "lecture de l'audio…")
        audio, sr = _read_upload(tmp.name)
        set_progress(token, "running", 5, "détection des notes…")
        notes = detect_notes(
            audio,
            sr,
            progress=lambda p: set_progress(
                token, "running", 5 + 85 * p, "détection des notes…"
            ),
        )
        set_progress(token, "running", 92, "génération de la tablature…")
        tab = _generate_tab(notes)
        set_progress(token, "done", 100, "transcription terminée")
        return {
            "ok": True,
            "duration": len(audio) / sr,
            "sample_rate": sr,
            "notes": notes,
            "tab": tab,
            "note_count": len(notes),
        }
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def _run_chords(data: bytes, suffix: str, token: str) -> dict:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    try:
        set_progress(token, "running", 3, "lecture de l'audio…")
        audio, sr = _read_upload(tmp.name)
        set_progress(token, "running", 8, "analyse harmonique…")
        chords, key_name, mode = detect_chords(
            audio,
            sr,
            progress=lambda p: set_progress(
                token, "running", 8 + 82 * p, "analyse harmonique…"
            ),
        )
        set_progress(token, "running", 92, "détection des répétitions…")
        names = [c["chord"] for c in chords]
        reps = detect_repetitions(names)
        set_progress(token, "done", 100, "accords terminés")
        return {
            "ok": True,
            "duration": len(audio) / sr,
            "chords": chords,
            "count": len(chords),
            "key": key_name,
            "mode": mode,
            "repetitions": reps,
        }
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), token: str = Form("")):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    try:
        return await run_in_threadpool(_run_transcribe, data, suffix, token)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - on renvoie un message lisible
        set_progress(token, "error", 0, str(exc))
        raise HTTPException(500, f"analyse impossible : {exc}")


@app.post("/chords")
async def chords_endpoint(file: UploadFile = File(...), token: str = Form("")):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "file too large")
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    try:
        return await run_in_threadpool(_run_chords, data, suffix, token)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        set_progress(token, "error", 0, str(exc))
        raise HTTPException(500, f"analyse impossible : {exc}")


@app.post("/repetitions")
async def detect_repetitions_endpoint(request: Request):
    body = await request.json()
    sequence = body.get("sequence", [])
    min_pattern = body.get("min_pattern", 2)
    min_repeats = body.get("min_repeats", 2)
    if not sequence:
        raise HTTPException(400, "sequence vide")
    best = detect_repetitions(sequence, min_pattern, min_repeats)
    all_p = detect_all_patterns(sequence, min_pattern, min_repeats)
    return {"ok": True, "best": best, "all": all_p[:10]}


if __name__ == "__main__":
    import socket

    import uvicorn

    port = int(os.environ.get("TRANSCRIBE_PORT", "8766"))

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        already_up = probe.connect_ex(("127.0.0.1", port)) == 0
    if already_up:
        print(f"[transcribe] un service ecoute deja sur le port {port} — rien a faire", flush=True)
        raise SystemExit(0)
    print(f"[transcribe] demarrage sur le port {port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port)
