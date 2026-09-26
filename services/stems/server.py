import io
import os
import tempfile
import zipfile
from pathlib import Path

import soundfile as sf
import uvicorn
from demucs_onnx import separate
from fastapi import FastAPI, File, HTTPException, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

app = FastAPI(title="ChordFlow Stems Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"]


@app.get("/health")
def health():
    return {"ok": True, "stems": STEM_NAMES}


@app.post("/separate")
async def separate_audio(file: UploadFile = File(...), stem: str = Query("vocals")):
    if stem not in STEM_NAMES:
        raise HTTPException(402, f"stem must be one of {STEM_NAMES}")

    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "file too large (max 200MB)")

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"input{suffix}"
        src.write_bytes(data)
        out_dir = Path(tmp) / "out"
        out_dir.mkdir()

        try:
            separate(str(src), str(out_dir), model="htdemucs_6s", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
        except Exception as e:
            raise HTTPException(500, f"separation failed: {e}") from e

        stem_path = out_dir / f"{stem}.wav"
        if not stem_path.exists():
            candidates = list(out_dir.glob("*.wav"))
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
    uvicorn.run(app, host="127.0.0.1", port=port)
