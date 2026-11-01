"""Processus de travail : une chanson, une séparation, puis le processus meurt.

Le service (server.py) lance ce script au lieu de séparer en son sein : c'est
ce qui garantit que la mémoire d'ONNX Runtime (plusieurs Go par chanson) est
rendue au système entre deux titres d'une rafale.

Deux réglages importants y sont appliqués :

- stdout se déclare « terminal » : demucs-onnx n'affiche sa barre de
  progression tqdm que dans ce cas, et le service en a besoin pour alimenter
  /progress (stderr est un tuyau, donc détecté comme non-TTY) ;
- l'arène mémoire du CPU est désactivée : sur une chanson de 4 min, ONNX
  Runtime réservait jusqu'à 10 Go de mémoire privée (fragmentation de l'arène
  entre les blocs), ce qui faisait échouer la séparation suivante sur
  « Unable to allocate 96.4 MiB ». Sans arène, chaque tenseur est libéré
  immédiatement ; un peu plus lent, mais la mémoire reste plate.
"""

import sys
import time

import onnxruntime as ort
import soundfile as sf
from demucs_onnx import inference
from demucs_onnx.cli import main


class _TtyStream:
    def __init__(self, stream):
        self._stream = stream

    def isatty(self) -> bool:
        return True

    def __getattr__(self, name):
        return getattr(self._stream, name)


def _make_session(onnx_path, providers):
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    return ort.InferenceSession(str(onnx_path), sess_options=opts, providers=list(providers))


sys.stdout = _TtyStream(sys.stdout)
inference._make_session = _make_session

def _attendre_lecture(chemin: str, essais: int = 10) -> None:
    # Un fichier qui vient d'être écrit peut rester verrouillé quelques instants
    # (antivirus) : libsndfile échoue alors avec « System error ».
    for _ in range(essais):
        try:
            sf.info(chemin)
            return
        except Exception:
            time.sleep(1)


if __name__ == "__main__":
    _attendre_lecture(sys.argv[1])
    raise SystemExit(main(["separate", *sys.argv[1:]]))
