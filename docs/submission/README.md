# Submission kit

Everything for the demo video and the Devpost page, and the scripts that produce and check it. The video is recorded by a script, so every beat can be rehearsed from a fresh workspace, and every number the voice-over quotes is measured on the take rather than written in advance.

| File | What it is |
| --- | --- |
| [video-script-live.md](video-script-live.md) | The script, beat by beat, with the numbers measured against the deployed site. The voice-over is generated from it. |
| [captions-live.srt](captions-live.srt) | Captions timed to the finished video. Upload to YouTube, or burn them in. |
| [measured-live.json](measured-live.json) | Every measured number, when each beat starts, and which waits were sped up. |
| `*-local.*` | The same three files from the rehearsal against the local demo server. |
| [thumbnail.png](thumbnail.png) | The 1280 by 720 thumbnail. |
| [devpost.md](devpost.md) | The Devpost text, ready to paste. |
| [judge-instructions.md](judge-instructions.md) | What a judge does in the first minute, and what to expect. |
| [upload-and-fallback.md](upload-and-fallback.md) | The upload checklist and the plan if the live demo fails. |

## How the video is made

The video is produced end to end by scripts, including a woman's voice-over, so nobody has to record audio.

1. **Rehearse.** Start the demo server (`pnpm --filter @bursar/web build`, then `PORT=8790 pnpm start:demo`) and run `pnpm demo:record`. It drives every beat from a brand-new workspace and fails if the take runs over 2:58.
2. **Record the real take.** `BASE_URL=https://bursar-demo.onrender.com pnpm demo:record`. This runs against the deployed site and PayPal's sandbox, and writes `.demo/live/demo.mp4`, a 1920 by 1080 screen track with a visible cursor, and the measured numbers above.
3. **Generate the voice.** `pnpm demo:narrate` writes the narration from the numbers the take measured, then speaks each beat with Kokoro, an open-source neural voice (the American woman's voice "Heart"). It runs on your Mac, with no account or key, and notes when every sentence starts. Run `pnpm demo:record` once more afterwards: this time each click lands on the sentence that describes it, every beat is held for as long as its audio runs, the take notes where the camera should look (`shots-<mode>.json`), and it checks that its numbers still match what was said.
4. **Render.** `pnpm demo:video` directs the take with Remotion into `.demo/live/final.mp4`: a virtual camera moves wide, medium and close over the real product to what the voice is describing, dims the rest, and marks each click; the opening and closing are set in type; an original music bed (synthesised by `apps/video/scripts/sound.py`, nothing to license) sits under the voice and ducks while it speaks, with quiet sounds for clicks and reveals. It uses the Chrome you already have. `STILLS=30,90 pnpm demo:video` renders single frames to check a shot quickly.
5. **Upload** `final.mp4` and `captions-live.srt` as the upload checklist says.

**One-time setup for the voice** (about 120 MB, kept in the git-ignored `.demo/voice`):

```bash
mkdir -p .demo/voice && cd .demo/voice
uv venv --python 3.12 venv
uv pip install --python venv/bin/python kokoro-onnx soundfile
curl -L -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx
curl -L -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

A different voice or pace is one variable: `VOICE=af_bella SPEED=0.95 pnpm demo:narrate`.

## What the take does, and what it measured

The take opens a workspace, runs the agents, approves a purchase, replays its receipt, runs the Gauntlet and the Policy Lab, asks the Treasurer a question, delays a delivery, and finally simulates a rogue capture. Two things are worth knowing:

- **Long waits are sped up, and say so.** The Policy Lab, for instance, takes about a minute on the deployed site. The finished video shows such waits at ten times speed with a "sped up" pill on screen, so nothing is hidden and the runtime stays under three minutes. Real and shown durations are in `measured-live.json`.
- **The kill switch is timed on PayPal's real sandbox.** On four takes the Verifier opened an incident between 16 and 26 seconds after the rogue capture. That includes PayPal's own delivery of the signed webhook, which is most of the wait. The voice-over quotes the number from the take being used.

## Dry run

The rehearsal and the live take both pass: all eleven beats complete from a fresh workspace, and the runtime is 2:51 against a limit of 2:58.

```bash
pnpm demo:record                                              # local rehearsal, PayPal's fake
BASE_URL=https://bursar-demo.onrender.com pnpm demo:record    # the real take, PayPal's sandbox
node --import tsx apps/e2e/recorder/thumbnail.ts              # regenerate the thumbnail
```
