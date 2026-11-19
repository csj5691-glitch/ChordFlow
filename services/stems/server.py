import asyncio
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
from fastapi.responses import Response, FileResponse
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

# Stockage persistant sur disque (survit au vidage du navigateur). Surcharge
# possible via STEMS_PERSIST_ROOT. Repli sur un dossier temporaire si le disque
# configure n'est pas accessible (ex. H: absent).
_persist_env = os.environ.get("STEMS_PERSIST_ROOT", r"H:\chordflow-stems")
PERSIST_ROOT = Path(_persist_env)
try:
    PERSIST_ROOT.mkdir(parents=True, exist_ok=True)
    _probe = PERSIST_ROOT / ".probe"
    _probe.write_text("ok", encoding="utf-8")
    _probe.unlink(missing_ok=True)
except OSError:
    PERSIST_ROOT = Path(tempfile.gettempdir()) / "chordflow-stems-persist"
    PERSIST_ROOT.mkdir(parents=True, exist_ok=True)

# Journal persistant (survit aux redémarrages) et chansons en échec conservées
# pour analyse. Fichiers : <TEMP>\chordflow-stems-logs\service.log et \failed\.
LOG_ROOT = Path(tempfile.gettempdir()) / "chordflow-stems-logs"
FAILED_KEEP = 5


def _journal(msg: str) -> None:
    line = f"{datetime.now().isoformat(timespec='seconds')} pid={os.getpid()} {msg}"
    print(f"[stems] {msg}", flush=True)
    try:
        LOG_ROOT.mkdir(parents=True, exist_ok=True)
        with open(LOG_ROOT / "service.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass

# onnxruntime peut annoncer CUDAExecutionProvider sans que cuDNN soit
# réellement présent. Sans cuDNN, le premier noyau Conv échoue
# (« LoadLibrary failed for cudnn64_9.dll ») : on le détecte au démarrage pour
# aller directement en CPU au lieu de gaspiller un essai GPU à chaque lancement.
#
# Il faut aussi cuBLAS 12 : cuDNN seul ne suffit pas (échec en cours de
# séparation sur « Could not locate cublasLt64_12.dll »). Sur cette machine les
# deux vivent hors du PATH (cuDNN dans Program Files, cuBLAS 12 installe via
# pip dans %USERPROFILE%\cuda-libs). On ajoute leurs dossiers ici ; le
# processus enfant (worker.py) herite du PATH modifie.
_DLL_HANDLES: list = []


def _candidats_dll_cuda() -> list[Path]:
    dirs: list[Path] = []
    env = os.environ.get("STEMS_CUDA_DLL_DIRS", "")
    for part in env.split(os.pathsep):
        if part.strip():
            dirs.append(Path(part.strip()))
    home = Path.home()
    # cuBLAS installe par pip (nvidia-cublas-cu12) dans un dossier dedie.
    for pattern in (
        "cuda-libs/nvidia/cublas/bin",
        "cuda-libs/nvidia/cudnn/bin",
        "cuda-libs/nvidia/cuda_runtime/bin",
    ):
        candidate = home / pattern
        if candidate.is_dir():
            dirs.append(candidate)
    # cuDNN 9 installe par l'installeur NVIDIA (version dans le chemin).
    prog = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    for version in sorted((prog / "NVIDIA" / "CUDNN").glob("v9*"), reverse=True):
        for sub in version.glob("bin/*/x64"):
            if sub.is_dir():
                dirs.append(sub)
    return dirs


def _ajouter_dll_cuda() -> None:
    for d in _candidats_dll_cuda():
        try:
            _DLL_HANDLES.append(os.add_dll_directory(str(d)))
        except (AttributeError, OSError):
            pass
        chemin = os.environ.get("PATH", "")
        if str(d) not in chemin.split(os.pathsep):
            os.environ["PATH"] = str(d) + os.pathsep + chemin


def _dll_chargeable(nom: str) -> bool:
    if os.name != "nt":
        return True
    try:
        import ctypes

        ctypes.WinDLL(nom)
        return True
    except OSError:
        return False


_ajouter_dll_cuda()
_use_cuda = _dll_chargeable("cudnn64_9.dll") and _dll_chargeable("cublasLt64_12.dll")

# Un pic memoire CUDA (navigateur, autre appli GPU) ne doit pas condamner toute
# la rafale au CPU : on compte les echecs consecutifs et on ne desactive le GPU
# qu'apres _CUDA_FAIL_MAX, chaque chanson repartant sur CUDA entre-temps.
_cuda_fails = 0
_CUDA_FAIL_MAX = 3


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
            _journal(f"purge {p.name[:12]} ({'ttl' if expired else 'max'})")
            shutil.rmtree(p, ignore_errors=True)


def _sonde_lecture(chemin: Path) -> str:
    try:
        with open(chemin, "rb") as f:
            f.read(16)
        return "lisible"
    except OSError as e:
        return f"illisible (winerror={getattr(e, 'winerror', None)}, errno={e.errno}, {e.strerror})"


_VERROUS_CHANSON: dict[str, asyncio.Lock] = {}


def _verrou_chanson(key: str) -> asyncio.Lock:
    """Une seule séparation par chanson : une requête en double attend la première."""
    return _VERROUS_CHANSON.setdefault(key, asyncio.Lock())


def _garder_echec(entry: Path, key: str, src: Path, erreur: str) -> None:
    """Conserve le dossier d'une chanson en échec (les 5 derniers) pour analyse."""
    present = src.exists()
    sonde = _sonde_lecture(src) if present else "non faite (fichier absent)"
    taille = f", {src.stat().st_size} o" if present else ""
    diag = f"erreur: {erreur}\nfichier: {'présent' if present else 'absent'}{taille}\nsonde: {sonde}\n"
    dest = None
    try:
        (entry / "diagnostic.txt").write_text(diag, encoding="utf-8")
        failed_root = LOG_ROOT / "failed"
        failed_root.mkdir(parents=True, exist_ok=True)
        dest = failed_root / f"{key[:12]}-{datetime.now():%Y%m%d-%H%M%S}"
        shutil.move(str(entry), str(dest))
        for old in sorted(failed_root.iterdir(), key=lambda p: p.stat().st_mtime)[:-FAILED_KEEP]:
            shutil.rmtree(old, ignore_errors=True)
    except OSError:
        shutil.rmtree(entry, ignore_errors=True)
        dest = None
    _journal(f"ECHEC {key[:12]} : {erreur} | sonde : {sonde} | dossier : {dest or 'supprime'}")


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
        str(Path(__file__).with_name("worker.py")),
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
    """Essaie CUDA puis retombe sur le CPU pour la chanson en cours.

    Un echec CUDA isole (souvent un pic memoire : navigateur, autre appli)
    ne doit pas condamner toute la rafale au CPU : on retente le GPU sur la
    chanson suivante, et on ne le desactive qu'apres _CUDA_FAIL_MAX echecs
    consecutifs (cuDNN/cuBLAS vraiment absents, GPU indisponible...).
    """
    global _use_cuda, _cuda_fails
    if _use_cuda:
        code, tail = _run_demucs(src, out_dir, "cuda", token)
        if code == 0:
            _cuda_fails = 0
            return
        _cuda_fails += 1
        print(
            f"[stems] echec CUDA ({_cuda_fails}/{_CUDA_FAIL_MAX}) : {tail[:300]} — CPU pour cette chanson",
            flush=True,
        )
        if _cuda_fails >= _CUDA_FAIL_MAX:
            _use_cuda = False
            print("[stems] CUDA desactive apres plusieurs echecs — passage en CPU", flush=True)
        for f in Path(out_dir).glob("*"):
            if f.is_file():
                try:
                    f.unlink()
                except OSError:
                    pass
    code, tail = _run_demucs(src, out_dir, "cpu", token)
    if code != 0:
        raise RuntimeError(tail or f"code {code}")


def _check_song_id(song_id: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", song_id or ""):
        raise HTTPException(400, "song_id invalide")


def _persist_stems(song_id: str, stems_dir: Path) -> None:
    """Copie les stems vers le stockage persistant sur disque (survit au vidage
    du navigateur). Les pistes manquantes sont ajoutées aux passages suivants :
    la rafale ne demande souvent qu'une seule piste à la fois."""
    _check_song_id(song_id)
    try:
        target = PERSIST_ROOT / song_id / "stems"
        target.mkdir(parents=True, exist_ok=True)
        copied = 0
        for wav in stems_dir.glob("*.wav"):
            dest = target / wav.name
            if dest.is_file() and dest.stat().st_size == wav.stat().st_size:
                continue
            shutil.copy2(wav, dest)
            copied += 1
        if copied:
            _journal(f"persist {song_id}: {copied} piste(s) -> {target}")
    except OSError as e:
        _journal(f"persist failed {song_id}: {e}")


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
def reset_memory(cuda: bool = Query(False)):
    """Libère les sessions ONNX et force le ramasse-miettes.

    Appelé par le client entre deux chansons d'une rafale : sans ça, la
    mémoire du service montait jusqu'à faire échouer la séparation suivante.

    `?cuda=1` (garde-fou, après libération mémoire) réactive aussi CUDA si les
    DLL sont chargeables : sinon `_use_cuda` restait bloqué à False jusqu'au
    redémarrage du process, et toute la suite tournait 3x plus lentement.
    """
    global _use_cuda, _cuda_fails
    _release_memory(drop_sessions=True)
    if cuda:
        _use_cuda = _dll_chargeable("cudnn64_9.dll") and _dll_chargeable("cublasLt64_12.dll")
        _cuda_fails = 0
        print(f"[stems] reset cuda -> _use_cuda={_use_cuda}", flush=True)
    return {"ok": True, "useCuda": _use_cuda}


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
    song_id: str = Query(None),
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
    if len(data) > 500 * 1024 * 1024:
        raise HTTPException(413, "file too large (max 500MB)")

    key = hashlib.sha256(data).hexdigest()
    entry = CACHE_ROOT / key
    stems_dir = entry / "stems"

    # Le jeton est enregistré dès l'arrivée de la requête : un job mis en file
    # derrière une séparation en cours reste ainsi visible sur /progress, au lieu
    # de renvoyer 404 jusqu'à l'obtention du verrou (_separate_lock).
    if progress_token:
        _mark_progress(progress_token, state="running", percent=0, line="en file d'attente…")

    _journal(f"requete {key[:12]} stem={stem}")
    async with _verrou_chanson(key):
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
                _journal(f"separation {key[:12]} ok en {time.time() - t0:.1f}s")
            except Exception as e:
                _garder_echec(entry, key, src, str(e))
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
            _journal(f"cache hit {key[:12]}")
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

    # Persistance sur disque : survit au vidage du navigateur. On persiste
    # des que song_id est fourni, en évitant de recopier si deja present.
    if song_id:
        try:
            _write_no_vocals(stems_dir)
        except Exception:
            pass
        _persist_stems(song_id, stems_dir)

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


@app.get("/stems")
def list_persisted_songs():
    """Inventaire disque : évite de relancer la rafale sur des chansons déjà
    extraites, même après un vidage du navigateur."""
    songs = []
    for entry in PERSIST_ROOT.iterdir():
        if not entry.is_dir():
            continue
        names = sorted(p.stem for p in (entry / "stems").glob("*.wav"))
        if names:
            songs.append({"song_id": entry.name, "stems": names})
    return {"songs": songs}


@app.get("/stems/{song_id}")
def list_persisted_stems(song_id: str):
    _check_song_id(song_id)
    stems_dir = PERSIST_ROOT / song_id / "stems"
    if not stems_dir.is_dir():
        raise HTTPException(404, "no persisted stems")
    names = [p.stem for p in stems_dir.glob("*.wav")]
    return {"song_id": song_id, "stems": names}


@app.get("/stems/{song_id}/{stem}")
def get_persisted_stem(song_id: str, stem: str):
    _check_song_id(song_id)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", stem or ""):
        raise HTTPException(400, "stem invalide")
    path = PERSIST_ROOT / song_id / "stems" / f"{stem}.wav"
    if not path.is_file():
        raise HTTPException(404, "stem not found")
    return FileResponse(path, media_type="audio/wav", filename=f"{stem}.wav")


@app.delete("/stems/{song_id}")
def delete_persisted_stems(song_id: str):
    _check_song_id(song_id)
    target = PERSIST_ROOT / song_id
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
    return {"ok": True}


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
        "si CUDA est annonce mais absent (cuDNN/cuBLAS), le service bascule seul sur le CPU.",
        flush=True,
    )
    _journal(f"demarrage port {port} modele {MODEL} device {info['device']}")
    uvicorn.run(app, host="127.0.0.1", port=port)
