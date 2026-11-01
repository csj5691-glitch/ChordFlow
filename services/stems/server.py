import gc
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import soundfile as sf
import uvicorn
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
# réellement présent. Sans cuDNN, le premier noyau Conv échoue
# (« LoadLibrary failed for cudnn64_9.dll ») : on le détecte au démarrage pour
# aller directement en CPU au lieu de gaspiller un essai GPU à chaque lancement.
def _cudnn_available() -> bool:
    if os.name != "nt":
        return True
    try:
        import ctypes

        ctypes.WinDLL("cudnn64_9.dll")
        return True
    except OSError:
        return False


_use_cuda = _cudnn_available()


def _hf_model_cached() -> bool:
    """Le modèle ONNX est-il déjà en cache local ?

    Si oui, on force le mode hors ligne dans le processus de séparation :
    plus d'avertissement « unauthenticated requests to the HF Hub » ni
    d'attente réseau à chaque rechargement du modèle.
    """
    if os.environ.get("HF_HOME"):
        root = Path(os.environ["HF_HOME"]) / "hub"
    else:
        root = Path.home() / ".cache" / "huggingface" / "hub"
    return (root / "models--StemSplitio--htdemucs-onnx").is_dir()

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
    """Séparation sérialisée (un seul processus Demucs à la fois)."""
    with _separate_lock:
        try:
            if token:
                entry = PROGRESS.get(token)
                if entry is None or entry.get("state") in ("done", "error"):
                    entry = _new_progress(token)
                entry.update(state="running", line="chargement du modèle…", updated=time.time())
            _separate_with_fallback(src, out_dir, token)
        finally:
            _release_memory()


def _release_memory(drop_sessions: bool = True) -> None:
    """Libère ce que garde le service (le gros du calcul est dans un sous-processus).

    Le modèle et les sessions ONNX vivent désormais dans le processus enfant,
    qui disparaît à la fin de chaque chanson : il ne reste ici que les tampons
    du fichier uploadé, que le ramasse-miettes récupère.
    """
    try:
        gc.collect()
    except Exception:
        pass


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


def _run_demucs(src: str, out_dir: str, providers: str, token: str | None) -> tuple[int, str]:
    """Lance la séparation dans un processus Python séparé.

    C'est le point clé pour les rafales de plusieurs centaines de chansons :
    ONNX Runtime ne rend pas vraiment son aréna au système (le service montait
    à 11 Go et la séparation suivante échouait sur « Unable to allocate
    96.4 MiB »). En sortant le calcul du service, la fin du processus rend
    toute la mémoire d'un coup ; le service, lui, reste léger (~100 Mo).

    Retourne (code de sortie, dernières lignes de stderr).
    """
    cmd = [
        sys.executable,
        "-m",
        "demucs_onnx.cli",
        "separate",
        src,
        out_dir,
        "--model",
        MODEL,
        "--providers",
        providers,
    ]
    env = dict(os.environ)
    if _hf_model_cached():
        env["HF_HUB_OFFLINE"] = "1"
        env["HF_HUB_DISABLE_TELEMETRY"] = "1"
    writer = _ProgressWriter(sys.stderr, token) if token else None
    tail: list[str] = []
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=env,
    )
    assert proc.stderr is not None
    for line in proc.stderr:
        if writer is not None:
            writer.write(line)
        else:
            try:
                sys.stderr.write(line)
            except Exception:
                pass
        if line.strip():
            tail.append(line.strip())
            if len(tail) > 20:
                tail.pop(0)
    code = proc.wait()
    return code, " | ".join(tail[-6:])


def _separate_with_fallback(src: str, out_dir: str, token: str | None = None) -> None:
    """Essaie CUDA puis retombe sur le CPU (cuDNN absent ou GPU indisponible)."""
    global _use_cuda
    if _use_cuda:
        code, tail = _run_demucs(src, out_dir, "cuda", token)
        if code == 0:
            return
        _use_cuda = False
        print(f"[stems] CUDA/CuDNN indisponible ({tail[:300]}) — passage en CPU", flush=True)
        for f in Path(out_dir).glob("*"):
            if f.is_file():
                try:
                    f.unlink()
                except OSError:
                    pass
    code, tail = _run_demucs(src, out_dir, "cpu", token)
    if code != 0:
        raise RuntimeError(tail or f"code {code}")


def _write_no_vocals(stems_dir: Path) -> Path:
    """Instrumental = somme des pistes non-voix effectivement générées.

    Somme par blocs : avant, on chargeait les pistes entières en float32
    (3 × ~96 Mo), ce qui participait aux échecs d'allocation mémoire.
    """
    names = [n for n in MODEL_STEM_NAMES if n != "vocals"]
    for name in names:
        if not (stems_dir / f"{name}.wav").is_file():
            raise HTTPException(500, f"missing stem {name}")

    target = stems_dir / "noVocals.wav"
    handles: dict[str, sf.SoundFile] = {}
    try:
        with sf.SoundFile(str(stems_dir / f"{names[0]}.wav")) as probe:
            sample_rate = probe.samplerate
            channels = probe.channels
        for name in names:
            handles[name] = sf.SoundFile(str(stems_dir / f"{name}.wav"))
        block = 262_144
        with sf.SoundFile(
            str(target),
            mode="w",
            samplerate=sample_rate,
            channels=channels,
            subtype="PCM_16",
        ) as out:
            while True:
                total = None
                finished = False
                for name in names:
                    chunk = handles[name].read(block, dtype="float32")
                    if chunk.size == 0:
                        finished = True
                        break
                    total = chunk if total is None else total + chunk
                if finished or total is None:
                    break
                np.clip(total, -1.0, 1.0, out=total)
                out.write(total)
    finally:
        for handle in handles.values():
            try:
                handle.close()
            except Exception:
                pass
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


@app.post("/reset")
def reset_memory():
    """Libère les sessions ONNX et force le ramasse-miettes.

    Appelé par le client entre deux chansons d'une rafale : sans ça, la
    mémoire du service montait jusqu'à faire échouer la séparation suivante.
    """
    _release_memory(drop_sessions=True)
    return {"ok": True}


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

    # Le jeton est enregistré dès l'arrivée de la requête : un job mis en file
    # derrière une séparation en cours reste ainsi visible sur /progress, au lieu
    # de renvoyer 404 jusqu'à l'obtention du verrou (_separate_lock).
    if progress_token:
        _mark_progress(progress_token, state="running", percent=0, line="en file d'attente…")

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
            # Windows : le fichier d'entrée peut rester verrouillé un court
            # instant (demucs/antivirus) -> WinError 32. Le cache étant purgé
            # par TTL, on ignore l'échec au lieu de transformer une séparation
            # réussie en 500.
            try:
                src.unlink(missing_ok=True)
            except OSError:
                pass
        entry.touch()
    else:
        entry.touch()
        print(f"[stems] cache hit {key[:12]}", flush=True)
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
