"""Turns the voice-over into speech, one audio file per beat, with Kokoro (an open-source neural voice, Apache-2.0).

Run from the repository root with the voice environment that `docs/submission/README.md` describes:

    .demo/voice/venv/bin/python apps/e2e/recorder/narrate.py            # MODE=live by default

Reads docs/submission/narration-<mode>.json. Writes .demo/voice/<mode>/<beat>.wav and durations.json (milliseconds
per beat), which the recorder uses to hold each beat on screen for as long as it is spoken.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

MODE = os.environ.get("MODE", "live")
VOICE = os.environ.get("VOICE", "af_heart")  # a warm American woman's voice
SPEED = float(os.environ.get("SPEED", "1.0"))
ROOT = Path(__file__).resolve().parents[3]
VOICE_DIR = ROOT / ".demo" / "voice"
OUT = VOICE_DIR / MODE
OUT.mkdir(parents=True, exist_ok=True)

narration = json.loads((ROOT / "docs" / "submission" / f"narration-{MODE}.json").read_text())
engine = Kokoro(str(VOICE_DIR / "kokoro-v1.0.int8.onnx"), str(VOICE_DIR / "voices-v1.0.bin"))

durations = {}
for beat in narration:
    # One sentence at a time with a short breath between, which sounds far more human than one long run.
    sentences = [s.strip() for s in beat["speech"].replace("\n", " ").split(". ") if s.strip()]
    pieces = []
    rate = 24000
    for i, sentence in enumerate(sentences):
        text = sentence if sentence.endswith((".", "?", "!")) else sentence + "."
        samples, rate = engine.create(text, voice=VOICE, speed=SPEED, lang="en-us")
        pieces.append(samples)
        if i < len(sentences) - 1:
            pieces.append(np.zeros(int(rate * 0.28), dtype=samples.dtype))
    audio = np.concatenate(pieces)
    sf.write(OUT / f"{beat['id']}.wav", audio, rate)
    durations[beat["id"]] = round(len(audio) / rate * 1000)
    words = len(beat["speech"].split())
    print(f"{beat['id']:9} {durations[beat['id']] / 1000:5.1f}s  {words / (durations[beat['id']] / 60000):4.0f} wpm", file=sys.stderr)

(OUT / "durations.json").write_text(json.dumps(durations, indent=2) + "\n")
print(f"{sum(durations.values()) / 1000:.1f}s of speech in {len(durations)} beats -> {OUT}")
