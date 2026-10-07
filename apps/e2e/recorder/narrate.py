"""Turns the voice-over into speech, one audio file per beat, with Kokoro (an open-source neural voice, Apache-2.0).

Run from the repository root with the voice environment that `docs/submission/README.md` describes:

    .demo/voice/venv/bin/python apps/e2e/recorder/narrate.py            # MODE=live by default

Reads docs/submission/narration-<mode>.json. Writes .demo/voice/<mode>/<beat>.wav, durations.json (milliseconds
per beat), which the recorder uses to hold each beat on screen for as long as it is spoken, and sentences.json (when
each sentence starts and ends within its beat), which paces the recorder's clicks and the video's camera.
"""
import json
import os
import re
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
timings = {}
for beat in narration:
    # One sentence at a time with a short breath between, which sounds far more human than one long run. Sentences
    # split the same way as the captions do (`sentencesOf` in the recorder's script), so the two line up.
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", beat["speech"].replace("\n", " ").strip()) if s]
    pieces = []
    spans = []
    rate = 24000
    at = 0
    for i, sentence in enumerate(sentences):
        samples, rate = engine.create(sentence, voice=VOICE, speed=SPEED, lang="en-us")
        pieces.append(samples)
        spans.append([round(at / rate * 1000), round((at + len(samples)) / rate * 1000)])
        at += len(samples)
        if i < len(sentences) - 1:
            pieces.append(np.zeros(int(rate * 0.28), dtype=samples.dtype))
            at += int(rate * 0.28)
    timings[beat["id"]] = spans
    audio = np.concatenate(pieces)
    sf.write(OUT / f"{beat['id']}.wav", audio, rate)
    durations[beat["id"]] = round(len(audio) / rate * 1000)
    words = len(beat["speech"].split())
    print(f"{beat['id']:9} {durations[beat['id']] / 1000:5.1f}s  {words / (durations[beat['id']] / 60000):4.0f} wpm", file=sys.stderr)

(OUT / "durations.json").write_text(json.dumps(durations, indent=2) + "\n")
(OUT / "sentences.json").write_text(json.dumps(timings) + "\n")
print(f"{sum(durations.values()) / 1000:.1f}s of speech in {len(durations)} beats -> {OUT}")
