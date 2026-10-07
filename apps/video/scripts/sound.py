"""The demo video's music bed and sound effects, synthesised from scratch, so there is nothing to license.

Run from the repository root with the voice environment (it only needs numpy and soundfile):

    MODE=live .demo/voice/venv/bin/python apps/video/scripts/sound.py

Reads docs/submission/timeline-<mode>.json for where each beat starts, so the music builds and settles with the
story. Writes .demo/sound/<mode>/music.wav and one file per effect. Seeded, so the same take gives the same sound.
"""
import json
import os
from pathlib import Path

import numpy as np
import soundfile as sf

MODE = os.environ.get("MODE", "live")
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / ".demo" / "sound" / MODE
OUT.mkdir(parents=True, exist_ok=True)
RATE = 44100
rng = np.random.default_rng(7)

beats = json.loads((ROOT / "docs" / "submission" / f"timeline-{MODE}.json").read_text())
start = {b["id"]: b["atMs"] / 1000 for b in beats}
LENGTH = beats[-1]["endMs"] / 1000 + 2.5
N = int(LENGTH * RATE)
t = np.arange(N) / RATE


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def lowpass(x, cutoff):
    """A one-pole low-pass, vectorised over a fixed cutoff."""
    a = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.empty_like(x)
    acc = 0.0
    # Done in blocks with a recurrence closed form would be faster; a plain loop over a short signal is fine.
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def lowpass_fast(x, cutoff):
    """The same one-pole low-pass for long signals, through the frequency domain."""
    a = np.exp(-2 * np.pi * cutoff / RATE)
    n = 1 << int(np.ceil(np.log2(len(x) + 4096)))
    kernel = (1 - a) * a ** np.arange(4096)
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(kernel, n), n)[: len(x)]


# ---------------------------------------------------------------------------------------------------------------
# Music: a slow A-minor progression, pads, a soft pluck arpeggio, a little pulse in the middle, resolving at the end
# ---------------------------------------------------------------------------------------------------------------

BPM = 100
BEAT = 60 / BPM
BAR = 4 * BEAT
CHORDS = [  # (bass, pad voicing) two bars each
    (45, [57, 60, 64, 67, 71]),  # A minor 9
    (41, [53, 57, 60, 64, 67]),  # F major 7 add 9
    (48, [55, 60, 62, 64, 67]),  # C add 9
    (40, [55, 59, 62, 64, 67]),  # E minor 7
]
SEG = 2 * BAR


def chord_at(time):
    return CHORDS[int(time // SEG) % len(CHORDS)]


def section_gain(points):
    """A gain curve from (beat id or seconds, level) points, each change eased over 1.6 s."""
    g = np.zeros(N)
    level = 0.0
    marks = []
    for when, value in points:
        sec = start[when] if isinstance(when, str) else when
        marks.append((sec, value))
    for sec, value in marks:
        i = int(sec * RATE)
        ramp = int(1.6 * RATE)
        end = min(N, i + ramp)
        if i < N:
            g[i:end] = level + (value - level) * (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, end - i)))
            g[end:] = value
        level = value
    return g


# Pads: three detuned band-limited saws per note, warm and dark, crossfaded chord to chord.
pad = np.zeros((N, 2))
fade = int(0.9 * RATE)
segments = int(np.ceil(LENGTH / SEG))
for s in range(segments):
    a = int(s * SEG * RATE)
    b = min(N, int((s + 1) * SEG * RATE) + fade)
    if a >= N:
        break
    tt = t[a:b]
    _, notes = CHORDS[s % len(CHORDS)]
    seg = np.zeros((b - a, 2))
    for note in notes:
        for detune, pan in ((-7, 0.2), (0, 0.5), (7, 0.8)):
            f = hz(note) * 2 ** (detune / 1200)
            phase = rng.uniform(0, 2 * np.pi)
            wave = sum(np.sin(2 * np.pi * f * k * tt + phase * k) * np.exp(-k / 2.6) / k for k in range(1, 7))
            seg[:, 0] += wave * (1 - pan)
            seg[:, 1] += wave * pan
    env = np.ones(b - a)
    env[:fade] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fade))
    tail = min(fade, b - a)
    env[-tail:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, tail))
    pad[a:b] += seg * env[:, None]
# A slow swell in brightness, so the bed breathes.
pad *= (0.85 + 0.15 * np.sin(2 * np.pi * t / (SEG * 2)))[:, None]
pad = np.stack([lowpass_fast(pad[:, 0], 1600), lowpass_fast(pad[:, 1], 1600)], axis=1) * 0.05

# Bass: a round sine on the root, on beats one and three.
bass = np.zeros(N)
time = 0.0
while time < LENGTH:
    root, _ = chord_at(time)
    i = int(time * RATE)
    n = min(N - i, int(BEAT * 1.9 * RATE))
    tt = np.arange(n) / RATE
    env = (1 - np.exp(-tt / 0.02)) * np.exp(-tt / 0.9)
    bass[i : i + n] += (np.sin(2 * np.pi * hz(root) * tt) + 0.25 * np.sin(4 * np.pi * hz(root) * tt)) * env
    time += 2 * BEAT
bass *= 0.16

# Pluck arpeggio: eighth notes over the chord, an octave up, with a ping-pong delay.
arp = np.zeros((N, 2))
time = 0.0
step = 0
pattern = [0, 2, 4, 1, 3, 2, 4, 3]
while time < LENGTH:
    _, notes = chord_at(time)
    note = notes[pattern[step % len(pattern)]] + 12
    i = int(time * RATE)
    n = min(N - i, int(0.7 * RATE))
    tt = np.arange(n) / RATE
    env = (1 - np.exp(-tt / 0.003)) * np.exp(-tt / 0.16)
    f = hz(note)
    tone = (np.sin(2 * np.pi * f * tt) + 0.18 * np.sin(6 * np.pi * f * tt)) * env
    pan = 0.35 if step % 2 == 0 else 0.65
    arp[i : i + n, 0] += tone * (1 - pan)
    arp[i : i + n, 1] += tone * pan
    time += BEAT / 2
    step += 1
delay = int(3 * BEAT / 2 * RATE)
wet = np.zeros_like(arp)
for k, gain in enumerate((0.38, 0.2, 0.1), start=1):
    d = delay * k
    side = (k + 1) % 2
    wet[d:, side] += arp[:-d, 0 if side else 1] * gain
arp = (arp + wet) * 0.07

# Pulse: a soft low kick on one and three, and a breathy hat on the off-beats.
kick = np.zeros(N)
hat = np.zeros(N)
time = 0.0
while time < LENGTH:
    i = int(time * RATE)
    n = min(N - i, int(0.35 * RATE))
    tt = np.arange(n) / RATE
    sweep = 2 * np.pi * np.cumsum(48 + 60 * np.exp(-tt / 0.04)) / RATE
    kick[i : i + n] += np.sin(sweep) * np.exp(-tt / 0.12)
    j = int((time + BEAT) * RATE)
    m = min(N - j, int(0.05 * RATE)) if j < N else 0
    if m > 0:
        noise = rng.standard_normal(m)
        hat[j : j + m] += np.diff(noise, prepend=0) * np.exp(-np.arange(m) / RATE / 0.012)
    time += 2 * BEAT
kick *= 0.22
hat *= 0.018

# How much of each layer plays in each part of the story.
g_pad = section_gain([(0.0, 0.0), (0.05, 1.0), ("rogue", 0.8), ("close", 1.0)])
g_bass = section_gain([(0.0, 0.0), ("plan", 1.0), ("rogue", 1.15), ("close", 0.6)])
g_arp = section_gain([(0.0, 0.0), ("mandate", 0.7), ("attack", 1.0), ("rogue", 0.0), ("close", 0.8)])
g_kick = section_gain([(0.0, 0.0), ("attack", 1.0), ("studio", 0.0), ("rogue", 0.7), ("close", 0.0)])
g_hat = section_gain([(0.0, 0.0), ("approve", 1.0), ("rogue", 0.0), ("close", 0.0)])

dry = pad * g_pad[:, None] + arp * g_arp[:, None]
dry[:, 0] += bass * g_bass + kick * g_kick + hat * g_hat
dry[:, 1] += bass * g_bass + kick * g_kick + hat * g_hat

# A long, dark room around the pads and plucks.
ir_len = int(2.8 * RATE)
ir_t = np.arange(ir_len) / RATE
size = 1 << int(np.ceil(np.log2(N + ir_len)))
mix = np.zeros_like(dry)
for ch in range(2):
    ir = rng.standard_normal(ir_len) * np.exp(-ir_t / 0.7)
    ir = lowpass_fast(ir, 3000)
    ir /= np.sqrt(np.sum(ir**2))
    verb = np.fft.irfft(np.fft.rfft(dry[:, ch], size) * np.fft.rfft(ir, size), size)[:N]
    mix[:, ch] = dry[:, ch] + 0.35 * verb

# Fade in and out, gently limit, and leave headroom: the video sets the level and ducks it under the voice.
edge = np.ones(N)
edge[: int(1.5 * RATE)] = np.linspace(0, 1, int(1.5 * RATE)) ** 2
edge[-int(3 * RATE) :] = np.linspace(1, 0, int(3 * RATE)) ** 2
mix *= edge[:, None]
mix = np.tanh(mix * 1.4) / 1.4
mix *= 0.5 / np.max(np.abs(mix))
sf.write(OUT / "music.wav", mix.astype(np.float32), RATE)

# ---------------------------------------------------------------------------------------------------------------
# Effects: quiet, short, and felt more than heard
# ---------------------------------------------------------------------------------------------------------------


def write(name, mono, pan=0.5):
    peak = np.max(np.abs(mono))
    mono = mono / peak * 0.7 if peak > 0 else mono
    stereo = np.stack([mono * (1 - pan) * 1.4, mono * pan * 1.4], axis=1)
    sf.write(OUT / f"{name}.wav", np.clip(stereo, -1, 1).astype(np.float32), RATE)


def secs(length):
    return np.arange(int(length * RATE)) / RATE


# A soft click: a brief tick of noise and a high, fast-decaying tone.
tt = secs(0.06)
click = np.diff(rng.standard_normal(len(tt)), prepend=0) * np.exp(-tt / 0.0025) * 0.6
click += np.sin(2 * np.pi * 2900 * tt) * np.exp(-tt / 0.01) * 0.5
write("click", click)

# A key press, for typing.
tt = secs(0.04)
write("tick", lowpass(np.diff(rng.standard_normal(len(tt)), prepend=0), 5000) * np.exp(-tt / 0.006))

# A whoosh: noise through a filter that opens and closes, moving left to right.
tt = secs(0.9)
cut = 250 + 2600 * np.sin(np.pi * tt / 0.9) ** 2
noise = rng.standard_normal(len(tt))
out = np.empty_like(noise)
acc = 0.0
for i in range(len(noise)):
    a = np.exp(-2 * np.pi * cut[i] / RATE)
    acc = (1 - a) * noise[i] + a * acc
    out[i] = acc
env = np.sin(np.pi * np.clip(tt / 0.9, 0, 1)) ** 3
whoosh = out * env
pan = np.linspace(0.3, 0.7, len(tt))
sf.write(
    OUT / "whoosh.wav",
    (np.stack([whoosh * (1 - pan), whoosh * pan], axis=1) / np.max(np.abs(whoosh)) * 0.8).astype(np.float32),
    RATE,
)

# A reveal: a low, round thump with a faint shimmer above it.
tt = secs(1.6)
sweep = 2 * np.pi * np.cumsum(40 + 55 * np.exp(-tt / 0.08)) / RATE
reveal = np.sin(sweep) * np.exp(-tt / 0.45)
reveal += lowpass(rng.standard_normal(len(tt)), 900) * np.exp(-tt / 0.5) * 0.25
reveal += (np.sin(2 * np.pi * 1760 * tt) + 0.6 * np.sin(2 * np.pi * 2637 * tt)) * np.exp(-tt / 0.6) * 0.05
write("reveal", reveal)

# A confirmation: two notes rising a fifth, bell-like.
tt = secs(1.2)
confirm = np.zeros(len(tt))
for offset, f in ((0.0, 1318.5), (0.085, 1975.5)):
    i = int(offset * RATE)
    u = tt[: len(tt) - i]
    confirm[i:] += (np.sin(2 * np.pi * f * u) + 0.2 * np.sin(4 * np.pi * f * u)) * np.exp(-u / 0.32)
write("confirm", confirm)

# An alert: two soft falling tones, a notice rather than an alarm.
tt = secs(0.9)
alert = np.zeros(len(tt))
for offset, f in ((0.0, 622.3), (0.16, 466.2)):
    i = int(offset * RATE)
    u = tt[: len(tt) - i]
    alert[i:] += (np.sin(2 * np.pi * f * u) + 0.12 * np.sin(6 * np.pi * f * u)) * (1 - np.exp(-u / 0.004)) * np.exp(-u / 0.2)
write("alert", alert)

print(f"{LENGTH:.1f}s of music and 6 effects -> {OUT}")
