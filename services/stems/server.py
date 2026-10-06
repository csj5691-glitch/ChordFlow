import hashlib
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn
from demucs_onnx import separate
from fastapi import FastAPI, File, HTTPException, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="ChordFlow Stems Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]
ALL_STEMS = STEM_NAMES + ["noVocals"]

# Modèle de séparation :
#  - "htdemucs"     : 4 pistes (vocals, drums, bass, other) — ~30 % plus rapide,
#                     pas de séparation piano/guitare ;
#  - "htdemucs_6s"  : 6 pistes (+ guitar, piano) — plus lent.
# Surcharge possible via la variable d'environnement STEMS_MODEL.
MODEL = os.environ.get("STEMS_MODEL", "htdemucs")
MODEL_STEMS = {
    "htdemucs": ["vocals", "drums", "bass", "other"],
    "htdemucs_6s": ["vocals", "drums", "bass", "guitar", "piano", "other"],
}
if MODEL not in MODEL_STEMS:
    raise SystemExit(f"STEMS_MODEL inconnu: {MODEL} (attendu: {', '.join(MODEL_STEMS)})")
MODEL_STEM_NAMES = MODEL_STEMS[MODEL]

CACHE_ROOT = Path(tempfile.gettempdir()) / "chordflow-stems-cache"
CACHE_TTL = 1800  # 30 minutes
CACHE_MAX = 4

# onnxruntime peut annoncer CUDAExecutionProvider sans que cuDNN soit
# réellement présent : on tente le GPU et _separate_with_fallback bascule sur
# le CPU au premier échec.
_use_cuda = True

# ---- Progression de la séparation -----------------------------------------
# Démucs (demucs_onnx) écrit sa barre tqdm « separating: 12%|…| 7/61 [..] »
# sur stderr. On capture stderr pendant la séparation d'un jeton pour exposer
# la progression au client (page Afficheur). La séparation est sérialisée par
# un verrou : le rediriger globalement reste alors sûr.
_separate_lock = threading.Lock()
_PROGRESS_MAX = 12
PROGRESS: dict[str, dict] = {}

_PROGRESS_RE = re.compile(r"separating.*?(\d{1,3})\s*%.*?(\d+)\s*/\s*(\d+)")


def _new_progress(token: str) -> dict:
    while len(PROGRESS) >= _PROGRESS_MAX:
        oldest = min(PROGRESS, key=lambda k: PROGRESS[k].get("updated", 0) or 0)
        PROGRESS.pop(oldest, None)
    entry = {
        "state": "running",
        "percent": 0,
        "current": 0,
        "total": 0,
        "line": "chargement du modèle…",
        "started": time.time(),
        "updated": time.time(),
    }
    PROGRESS[token] = entry
    return entry


def _mark_progress(token: str | None, **updates) -> None:
    if not token:
        return
    entry = PROGRESS.get(token)
    if entry is None:
        entry = _new_progress(token)
    entry.update(updates)
    entry["updated"] = time.time()


class _ProgressWriter:
    """Flux qui relaie les écritures de stderr et parse la barre tqdm."""

    def __init__(self, sink, token: str):
        self.sink = sink
        self.token = token
        self._buf = ""

    def write(self, s: str) -> int:
        try:
            self.sink.write(s)
        except Exception:
            pass
        self._buf += s
        while "\n" in self._buf or "\r" in self._buf:
            i = self._buf.find("\n")
            if i == -1:
                i = self._buf.find("\r")
            line, self._buf = self._buf[:i], self._buf[i + 1 :]
            self._handle(line)
        return len(s)

    def flush(self) -> None:
        try:
            self.sink.flush()
        except Exception:
            pass

    def isatty(self) -> bool:
        return False

    def close(self) -> None:
        self.flush()

    def _handle(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        entry = PROGRESS.get(self.token)
        if entry is None or entry.get("state") != "running":
            return
        m = _PROGRESS_RE.search(line)
        if m:
            entry.update(
                {
                    "percent": int(m.group(1)),
                    "current": int(m.group(2)),
                    "total": int(m.group(3)),
                    "line": line,
                    "updated": time.time(),
                }
            )
        elif line.startswith("[stems]") or line.startswith("Traceback"):
            entry["line"] = line


def _captured_separate(src: str, out_dir: str, token: str | None) -> None:
    """Séparation sérialisée, avec capture stderr quand un jeton est fourni."""
    with _separate_lock:
        if token:
            entry = PROGRESS.get(token)
            if entry is None or entry.get("state") in ("done", "error"):
                entry = _new_progress(token)
            entry.update(state="running", updated=time.time())
            orig = sys.stderr
            try:
                sys.stderr = _ProgressWriter(orig, token)
                _separate_with_fallback(src, out_dir)
                return
            finally:
                sys.stderr = orig
        _separate_with_fallback(src, out_dir)


def _purge_cache() -> None:
    if not CACHE_ROOT.is_dir():
        return
    now = time.time()
    try:
        entries = sorted(
            CACHE_ROOT.iterdir(),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return
    for i, p in enumerate(entries):
        if not p.is_dir():
            continue
        try:
            expired = now - p.stat().st_mtime > CACHE_TTL
        except OSError:
            continue
        if expired or i >= CACHE_MAX:
            shutil.rmtree(p, ignore_errors=True)


def _separate_with_fallback(src: str, out_dir: str) -> None:
    """Essaie CUDA puis retombe sur le CPU (cuDNN absent ou GPU indisponible)."""
    global _use_cuda
    if _use_cuda:
        try:
            separate(
                str(src),
                str(out_dir),
                model=MODEL,
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
            return
        except Exception as e:
            _use_cuda = False
            print(f"[stems] CUDA/CuDNN indisponible ({e}) — passage en CPU", flush=True)
            for f in Path(out_dir).glob("*"):
                if f.is_file():
                    f.unlink()
    separate(str(src), str(out_dir), model=MODEL, providers=["CPUExecutionProvider"])


def _write_no_vocals(stems_dir: Path) -> Path:
    """Instrumental = somme des pistes non-voix effectivement générées."""
    names = [n for n in MODEL_STEM_NAMES if n != "vocals"]
    total = None
    sample_rate = None
    for name in names:
        p = stems_dir / f"{name}.wav"
        if not p.is_file():
            raise HTTPException(500, f"missing stem {name}")
        data, sr = sf.read(str(p), dtype="float32")
        sample_rate = sr
        total = data if total is None else total + data
    total = np.clip(total, -1.0, 1.0)
    target = stems_dir / "noVocals.wav"
    sf.write(str(target), total, sample_rate, subtype="PCM_16")
    return target


def _device_info():
    """Peripherique reellement utilise (CUDA puis CPU) + capacites onnxruntime."""
    import onnxruntime

    try:
        providers = list(onnxruntime.get_available_providers())
    except Exception:
        providers = []
    cuda_available = "CUDAExecutionProvider" in providers
    device = "cuda" if (_use_cuda and cuda_available) else "cpu"
    return {
        "device": device,  # ce qui est utilise pour la separation
        "cudaAvailable": cuda_available,  # cuDNN peut manquer malgre le provider
        "providers": providers,
        "ortVersion": getattr(onnxruntime, "__version__", ""),
    }


@app.get("/health")
def health():
    info = _device_info()
    return {
        "ok": True,
        "stems": ALL_STEMS,
        "model": MODEL,
        "available": MODEL_STEM_NAMES + ["noVocals"],
        **info,
    }


@app.post("/separate")
async def separate_audio(
    file: UploadFile = File(...),
    stem: str = Query("vocals"),
    progress_token: str = Query(None),
):
    if stem not in ALL_STEMS:
        raise HTTPException(402, f"stem must be one of {ALL_STEMS}")
    if stem not in MODEL_STEM_NAMES and stem != "noVocals":
        raise HTTPException(
            400,
            f"stem « {stem} » indisponible avec le modèle {MODEL} "
            f"(pistes disponibles : {', '.join(MODEL_STEM_NAMES)}). "
            "Relance avec STEMS_MODEL=htdemucs_6s pour la séparation piano/guitare.",
        )

    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "file too large (max 200MB)")

    key = hashlib.sha256(data).hexdigest()
    entry = CACHE_ROOT / key
    stems_dir = entry / "stems"

    if not (stems_dir / "vocals.wav").is_file():
        _purge_cache()
        entry.mkdir(parents=True, exist_ok=True)
        src = entry / f"input{suffix}"
        src.write_bytes(data)
        stems_dir.mkdir(exist_ok=True)
        try:
            t0 = time.time()
            # `separate()` est bloquant (ONNX CPU) : on le déporte dans un
            # thread pour que la boucle d'événements reste libre — sinon
            # /health ne répond plus pendant plusieurs minutes et les requêtes
            # suivantes s'empilent.
            await run_in_threadpool(_captured_separate, str(src), str(stems_dir), progress_token)
            print(f"[stems] séparation {key[:12]} en {time.time() - t0:.1f}s", flush=True)
        except Exception as e:
            shutil.rmtree(entry, ignore_errors=True)
            _mark_progress(progress_token, state="error", line=f"échec: {e}")
            raise HTTPException(500, f"separation failed: {e}") from e
        finally:
            src.unlink(missing_ok=True)
        entry.touch()
    else:
        entry.touch()
        print(f"[stems] cache hit {key[:12]}", flush=True)
        if progress_token and progress_token not in PROGRESS:
            _mark_progress(progress_token, state="done", percent=100, line="déjà en cache")

    if stem == "noVocals":
        try:
            stem_path = _write_no_vocals(stems_dir)
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"noVocals mix failed: {e}") from e
    else:
        stem_path = stems_dir / f"{stem}.wav"
        if not stem_path.is_file():
            candidates = list(stems_dir.glob("*.wav"))
            if not candidates:
                raise HTTPException(500, "no output generated")
            stem_path = candidates[0]

    audio = stem_path.read_bytes()
    _mark_progress(progress_token, state="done", percent=100, line="séparation terminée")

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"X-Stem": stem},
    )


@app.get("/progress")
def progress(token: str = Query(...)):
    entry = PROGRESS.get(token)
    if entry is None:
        raise HTTPException(404, "token inconnu")
    return {
        **entry,
        "elapsed": round(max(0, time.time() - entry.get("started", time.time())), 1),
    }


if __name__ == "__main__":
    port = int(os.environ.get("STEMS_PORT", "8765"))
    # Un service déjà en écoute ne doit pas provoquer une erreur de bind
    # ([WinError 10048]) ni une boucle de redémarrage dans start-stems.bat.
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        already_up = probe.connect_ex(("127.0.0.1", port)) == 0
    if already_up:
        print(
            f"[stems] un service ecoute deja sur le port {port} — rien a faire "
            "(ferme l'autre fenetre ou attends qu'il s'arrete).",
            flush=True,
        )
        raise SystemExit(0)
    info = _device_info()
    print(
        f"[stems] demarrage sur le port {port} — modele {MODEL} — "
        f"device {info['device']} — providers {', '.join(info['providers'])} "
        f"(onnxruntime {info['ortVersion'] or '?'}); "
        "si CUDA est annonce mais absent (cuDNN), le service bascule seul sur le CPU.",
        flush=True,
    )
    uvicorn.run(app, host="127.0.0.1", port=port)
