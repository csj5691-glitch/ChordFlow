import io
import os
import tempfile
from pathlib import Path

import soundfile as sf
import uvicorn
from demucs_onnx import separate_stem
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response

app = FastAPI(title="ChordFlow Stems Service")

STEM_CHOICES = {"vocals", "drums", "bass", "other"}


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/separate")
async def separate(file: UploadFile = File(...), stem: str = "vocals"):
    if stem not in STEM_CHOICES:
        raise HTTPException(402, f"stem must be one of {STEM_CHOICES}")

    suffix = Path(file.filename or "audio.mp3").suffix or ".mp3"
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"input{suffix}"
        src.write_bytes(data)
        out_dir = Path(tmp) / "out"
        out_dir.mkdir()

        try:
            separate_stem(str(src), str(out_dir), stem=stem)
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
