# Upload checklist and fallback plan

## Before recording the real take

- [ ] The deployed site is healthy: <https://bursar-demo.onrender.com/healthz> answers 200, and a fresh workspace opens.
- [ ] Render shows the web service, Postgres, the cron job and the Workflow all deployed. If the web service has `BURSAR_WORKFLOWS=render` and `RENDER_WORKFLOW_SLUG=bursar`, the mission trace shows "Ran on a Render Workflow"; if it does not, say nothing about the Workflow in the voice-over.
- [ ] The sandbox buyer pool has a buyer (`.bursar/payers.json` locally; the deployed pool is already set).
- [ ] Do a rehearsal first (`pnpm demo:record` against the local server) to prove every beat runs.
- [ ] Run the real take (`BASE_URL=https://bursar-demo.onrender.com pnpm demo:record`). It exits with an error if the runtime is over 2:58.
- [ ] Check the numbers in `video-script-live.md` read sensibly, then record the voice-over from it.

## The finished video

- [ ] Runtime 2:58 or less. Resolution 1920 by 1080.
- [ ] A voice-over, a single clear take per beat, about 155 words a minute. Music, if any, under minus 24 LUFS.
- [ ] Captions from `captions-live.srt` (uploaded, or burned in).
- [ ] "Sandbox" and "SIM" badges are visible on screen. Nothing shows a key, a token or real personal data.
- [ ] Watch it once on a phone.

## YouTube

- [ ] **Public**, not unlisted, not private.
- [ ] Title: `Bursar: spend authority for AI agents | PayPal AI Hackathon`.
- [ ] Description: the live URL, the repository, and one line: "Sandbox only. What is real and what is simulated is in the README."
- [ ] The thumbnail from `thumbnail.png`.
- [ ] Captions uploaded, language English.

## Devpost

- [ ] Paste each section of `devpost.md`. Add the YouTube link at the end.
- [ ] Add the live demo URL and the repository URL.
- [ ] Choose the categories and sponsor prizes the project genuinely uses.
- [ ] Attach the thumbnail and two or three screenshots: the cockpit, the receipt, the Gauntlet.

## After submitting, in a private window

- [ ] The YouTube link plays signed out.
- [ ] The repository is public and the README renders with its diagram.
- [ ] The live demo opens a workspace signed out.
- [ ] The Devpost page shows the video.

## If the live demo fails on the day

1. **The site is down or slow.** Say so in the Devpost text, and lean on the video, which was recorded against the real site. The repository also runs the whole product with no keys: `pnpm install && pnpm dev:demo` and `pnpm dev:web`, in a few minutes.
2. **A single beat fails during recording.** Each beat is independent and starts from a fresh workspace. Re-record the take rather than patching it; it takes about four minutes.
3. **PayPal's sandbox is having trouble.** Record against the local server instead (`pnpm demo:record`), which uses the fake, and say in the video's description that the take was recorded on the local build. The numbers will differ (the kill switch takes about two seconds on the fake), and the script fills in whichever it measured.
4. **Keep a spare.** Record one extra complete take a week before the deadline and keep it, so a late failure costs nothing.
