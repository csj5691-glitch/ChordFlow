import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="ChordFlow Transcribe Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def yin_pitch(audio: np.ndarray, sr: int, frame_size: int = 2048, hop: int = 512, threshold: float = 0.15) -> list:
    """Detection de pitch par algorithme YIN. Retourne une liste de (time, freq, prob)."""
    results = []
    n = len(audio)
    for start in range(0, n - frame_size, hop):
        frame = audio[start:start + frame_size]
        # Difference function
        tau_max = frame_size // 2
        d = np.zeros(tau_max)
        for tau in range(1, tau_max):
            d[tau] = np.sum((frame[:tau_max] - frame[tau:tau + tau_max]) ** 2)
        # Cumulative mean normalized difference
        d_norm = np.zeros(tau_max)
        running = 0.0
        for tau in range(1, tau_max):
            running += d[tau]
            if running > 0:
                d_norm[tau] = d[tau] * tau / running
            else:
                d_norm[tau] = 1.0
        # Absolute threshold
        tau = 0
        for t in range(2, tau_max):
            if d_norm[t] < threshold:
                # find local minimum
                while t + 1 < tau_max and d_norm[t + 1] < d_norm[t]:
                    t += 1
                tau = t
                break
        if tau == 0:
            results.append((start / sr, 0.0, 0.0))
            continue
        # Parabolic interpolation
        if 1 <= tau < tau_max - 1:
            alpha = d_norm[tau - 1]
            beta = d_norm[tau]
            gamma = d_norm[tau + 1]
            p = (alpha - gamma) / (2 * (alpha - 2 * beta + gamma) + 1e-12)
            tau += p
        freq = sr / tau if tau > 0 else 0.0
        prob = 1.0 - d_norm[min(int(round(tau)), tau_max - 1)] if tau > 0 else 0.0
        prob = max(0.0, min(1.0, prob))
        results.append((start / sr, freq, prob))
    return results


def midi_from_freq(freq: float) -> int:
    if freq <= 0:
        return 0
    import math
    return int(round(69 + 12 * math.log2(freq / 440.0)))


def freq_to_note_name(midi: int) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    if midi == 0:
        return "R"
    octave = (midi // 12) - 1
    return f"{names[midi % 12]}{octave}"


def guitar_string_fret(midi: int) -> tuple:
    """Mappe une note MIDI sur la meilleure corde/case de guitare standard.
    Retourne (corde 1-6, case 0-24) ou (None, None) si impossible."""
    # Accordage standard EADGBE (MIDI: 40,45,50,55,59,64)
    open_strings = [40, 45, 50, 55, 59, 64]  # corde 6..1
    best = None
    for si, open_midi in enumerate(open_strings):
        fret = midi - open_midi
        if 0 <= fret <= 24:
            if best is None or fret < best[1]:
                best = (6 - si, fret)
    if best is None:
        return (None, None)
    return best


@app.get("/health")
def health():
    return {"ok": True, "service": "transcribe", "version": "0.1"}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    import tempfile, os
    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "file too large")

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()

    try:
        audio, sr = sf.read(tmp.name, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)  # mono
        # Normalise
        peak = np.max(np.abs(audio)) if len(audio) > 0 else 1.0
        if peak > 0:
            audio = audio / peak

        # Pitch detection
        pitches = yin_pitch(audio, sr)

        # Onset detection + note segmentation
        notes = []
        current_note = None
        for time_s, freq, prob in pitches:
            if prob < 0.5 or freq < 50 or freq > 2000:
                if current_note is not None:
                    notes.append(current_note)
                    current_note = None
                continue
            midi = midi_from_freq(freq)
            if current_note is not None and current_note["midi"] == midi:
                current_note["end"] = time_s
            else:
                if current_note is not None:
                    notes.append(current_note)
                current_note = {"start": time_s, "end": time_s, "midi": midi, "prob": prob}

        if current_note is not None:
            notes.append(current_note)

        # Filtrer les notes trop courtes
        min_dur = 0.05
        notes = [n for n in notes if (n["end"] - n["start"]) >= min_dur]

        # Mapper sur la guitare
        for n in notes:
            s, f = guitar_string_fret(n["midi"])
            n["string"] = s
            n["fret"] = f
            n["note"] = freq_to_note_name(n["midi"])

        # Generer la tablature ASCII
        tab_lines = _generate_tab(notes)

        return {
            "ok": True,
            "duration": len(audio) / sr,
            "sample_rate": sr,
            "notes": notes,
            "tab": tab_lines,
            "note_count": len(notes),
        }
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def _generate_tab(notes: list) -> str:
    """Genere une tablature ASCII simple a partir des notes."""
    if not notes:
        return ""
    # 6 cordes, cases par temps
    strings = {1: [], 2: [], 3: [], 4: [], 5: [], 6: []}
    for n in notes:
        s = n.get("string")
        f = n.get("fret")
        if s is None or f is None:
            continue
        strings[s].append((n["start"], f))

    # Trouver le temps max
    max_time = max((n["end"] for n in notes), default=0)
    # Resoudre en colonnes de 0.25s
    col_width = 0.25
    num_cols = int(max_time / col_width) + 1

    # Construire la tab
    lines = []
    for s in range(1, 7):
        row = ["-"] * (num_cols * 2)
        for t, fret in strings.get(s, []):
            col = int(t / col_width)
            pos = col * 2
            if pos < len(row):
                fstr = str(fret)
                for ci, ch in enumerate(fstr):
                    if pos + ci < len(row):
                        row[pos + ci] = ch
        lines.append(f"e|{''.join(row)}|" if s == 1 else f"{'BGDAE'[s-2]}|{''.join(row)}|")
    # Fix first string label
    string_labels = {1: "e", 2: "B", 3: "G", 4: "D", 5: "A", 6: "E"}
    lines = []
    for s in range(1, 7):
        row = ["-"] * (num_cols * 2)
        for t, fret in strings.get(s, []):
            col = int(t / col_width)
            pos = col * 2
            if pos < len(row):
                fstr = str(fret)
                for ci, ch in enumerate(fstr):
                    if pos + ci < len(row):
                        row[pos + ci] = ch
        lines.append(f"{string_labels[s]}|{''.join(row)}|")
    return "\n".join(lines)

# -*- coding: utf-8 -*-
"""Detection d'accords par chroma + templates. A ajouter a server.py."""

import numpy as np
from scipy import signal as sp_signal

# Templates d'accords : pour chaque type, les pitch classes presentes (0=C..11=B)
CHORD_TEMPLATES = {}
_ROOTS = list(range(12))
_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Major: root, major third (+4), fifth (+7)
for r in _ROOTS:
    v = np.zeros(12)
    for off in (0, 4, 7):
        v[(r + off) % 12] = 1.0
    CHORD_TEMPLATES[f"{_NAMES[r]}"] = v
# Minor: root, minor third (+3), fifth (+7)
for r in _ROOTS:
    v = np.zeros(12)
    for off in (0, 3, 7):
        v[(r + off) % 12] = 1.0
    CHORD_TEMPLATES[f"{_NAMES[r]}m"] = v
# Dominant 7: root, major third, fifth, minor seventh (+10)
for r in _ROOTS:
    v = np.zeros(12)
    for off in (0, 4, 7, 10):
        v[(r + off) % 12] = 1.0
    CHORD_TEMPLATES[f"{_NAMES[r]}7"] = v
# Major 7
for r in _ROOTS:
    v = np.zeros(12)
    for off in (0, 4, 7, 11):
        v[(r + off) % 12] = 1.0
    CHORD_TEMPLATES[f"{_NAMES[r]}maj7"] = v
# Minor 7
for r in _ROOTS:
    v = np.zeros(12)
    for off in (0, 3, 7, 10):
        v[(r + off) % 12] = 1.0
    CHORD_TEMPLATES[f"{_NAMES[r]}m7"] = v
# Sus2
for r in _ROOTS:
    v = np.zeros(12)
    for off in (0, 2, 7):
        v[(r + off) % 12] = 1.0
    CHORD_TEMPLATES[f"{_NAMES[r]}sus2"] = v
# Sus4
for r in _ROOTS:
    v = np.zeros(12)
    for off in (0, 5, 7):
        v[(r + off) % 12] = 1.0
    CHORD_TEMPLATES[f"{_NAMES[r]}sus4"] = v

# Normaliser les templates
for k in CHORD_TEMPLATES:
    n = np.linalg.norm(CHORD_TEMPLATES[k])
    if n > 0:
        CHORD_TEMPLATES[k] = CHORD_TEMPLATES[k] / n

CHORD_NAMES_LIST = list(CHORD_TEMPLATES.keys())
CHORD_MATRIX = np.array([CHORD_TEMPLATES[k] for k in CHORD_NAMES_LIST])  # (N, 12)


def compute_chroma(audio: np.ndarray, sr: int, frame_size: int = 4096, hop: int = 2048) -> tuple:
    """Calcule la chroma (12 bins) par frame. Retourne (chroma (12, n_frames), times)."""
    # STFT
    f, t, Zxx = sp_signal.stft(audio, fs=sr, nperseg=frame_size, noverlap=frame_size - hop, window="hann")
    mag = np.abs(Zxx)  # (freq_bins, n_frames)

    # Mapper les bins de frequence sur les 12 classes de pitch
    n_frames = mag.shape[1]
    chroma = np.zeros((12, n_frames))
    for fi in range(mag.shape[0]):
        freq = f[fi]
        if freq < 65 or freq > 2100:
            continue
        # MIDI note number
        midi = 69 + 12 * np.log2(freq / 440.0)
        pc = int(round(midi)) % 12
        chroma[pc] += mag[fi]

    # Normaliser par frame
    for j in range(n_frames):
        nrm = np.linalg.norm(chroma[:, j])
        if nrm > 0:
            chroma[:, j] = chroma[:, j] / nrm

    return chroma, t


def detect_chords(audio: np.ndarray, sr: int) -> list:
    """Detecte les accords dans l'audio. Retourne une liste de {start, end, chord}."""
    chroma, times = compute_chroma(audio, sr)
    n_frames = chroma.shape[1]
    if n_frames == 0:
        return []

    # Score de chaque accord pour chaque frame : (N_chords, n_frames)
    scores = CHORD_MATRIX @ chroma  # (N, 12) @ (12, F) = (N, F)

    # Meilleur accord par frame
    best_idx = np.argmax(scores, axis=0)  # (n_frames,)
    best_score = np.max(scores, axis=0)   # (n_frames,)

    # Seuil : si le score est trop bas, c'est du silence/bruit
    SILENCE_THRESHOLD = 0.3
    chords_seq = []
    for j in range(n_frames):
        if best_score[j] < SILENCE_THRESHOLD:
            chords_seq.append(None)
        else:
            chords_seq.append(CHORD_NAMES_LIST[best_idx[j]])

    # Lisser : supprimer les changements trop courts (< 0.5s)
    # Convertir en segments
    segments = []
    current = chords_seq[0]
    start_frame = 0
    for j in range(1, n_frames):
        if chords_seq[j] != current:
            segments.append((start_frame, j - 1, current))
            current = chords_seq[j]
            start_frame = j
    segments.append((start_frame, n_frames - 1, current))

    # Filtrer les segments trop courts et les None
    min_frames = int(0.3 / (times[1] - times[0])) if len(times) > 1 else 3
    filtered = []
    for s, e, c in segments:
        if c is None:
            continue
        if (e - s + 1) < min_frames:
            continue
        filtered.append((s, e, c))

    # Fusionner les segments adjacents de meme accord
    merged = []
    for s, e, c in filtered:
        if merged and merged[-1][2] == c:
            merged[-1] = (merged[-1][0], e, c)
        else:
            merged.append((s, e, c))

    # Convertir en temps
    result = []
    for s, e, c in merged:
        t_start = float(times[s]) if s < len(times) else 0.0
        t_end = float(times[min(e, len(times) - 1)]) if e < len(times) else float(times[-1])
        result.append({"start": round(t_start, 2), "end": round(t_end, 2), "chord": c})

    return result


@app.post("/chords")
async def detect_chords_endpoint(file: UploadFile = File(...)):
    import tempfile, os
    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    try:
        audio, sr = sf.read(tmp.name, dtype='float32')
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        peak = np.max(np.abs(audio)) if len(audio) > 0 else 1.0
        if peak > 0:
            audio = audio / peak
        chords = detect_chords(audio, sr)
        return {"ok": True, "duration": len(audio) / sr, "chords": chords, "count": len(chords)}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TRANSCRIBE_PORT", "8766"))
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        already_up = probe.connect_ex(("127.0.0.1", port)) == 0
    if already_up:
        print(f"[transcribe] un service ecoute deja sur le port {port} ÔÇö rien a faire", flush=True)
        raise SystemExit(0)
    print(f"[transcribe] demarrage sur le port {port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port)
