import hashlib
import os
import shutil
import tempfile
import time
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


@app.get("/health")
def health():
    return {
        "ok": True,
        "stems": ALL_STEMS,
        "model": MODEL,
        "available": MODEL_STEM_NAMES + ["noVocals"],
    }


@app.post("/separate")
async def separate_audio(file: UploadFile = File(...), stem: str = Query("vocals")):
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
            await run_in_threadpool(_separate_with_fallback, str(src), str(stems_dir))
            print(f"[stems] séparation {key[:12]} en {time.time() - t0:.1f}s", flush=True)
        except Exception as e:
            shutil.rmtree(entry, ignore_errors=True)
            raise HTTPException(500, f"separation failed: {e}") from e
        finally:
            src.unlink(missing_ok=True)
        entry.touch()
    else:
        entry.touch()
        print(f"[stems] cache hit {key[:12]}", flush=True)

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

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"X-Stem": stem},
    )


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
    uvicorn.run(app, host="127.0.0.1", port=port)
