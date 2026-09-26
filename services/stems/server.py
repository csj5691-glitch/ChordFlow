import os
import tempfile
import zipfile
from pathlib import Path

import uvicorn
from demucs_onnx import separate
from fastapi import FastAPI, File, HTTPException, UploadFile
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
async def separate_audio(file: UploadFile = File(...)):
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

        zip_path = Path(tmp) / "stems.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
            for stem in STEM_NAMES:
                wav = out_dir / f"{stem}.wav"
                if wav.exists():
                    zf.write(wav, arcname=f"{stem}.wav")

        zip_bytes = zip_path.read_bytes()

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"X-Stems": ",".join(STEM_NAMES)},
    )


if __name__ == "__main__":
    port = int(os.environ.get("STEMS_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port)
