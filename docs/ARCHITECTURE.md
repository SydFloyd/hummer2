# Hummer Architecture (Pre-Percussion)

## Current App Shape
- Frontend is static HTML/CSS/JS served by `server.py`.
- Melody flow lives in `app.js`:
  - capture/recording
  - TorchCREPE request
  - feature modeling and note segmentation
  - raw/autotune/original playback
  - MIDI timeline rendering
- Backend provides:
  - `GET /api/health`
  - `POST /api/torchcrepe-track`

## Recent Cleanup
- Shared frontend utilities moved into `audio-core.js` and exposed as `window.HummerCore`.
- `app.js` now consumes `HummerCore` for:
  - audio conversion (`toMono`, `trimAudioBufferTail`)
  - numeric helpers (`clamp`, `percentile`, etc.)
  - pitch conversion (`hzToMidi`, `midiToHz`)
- Backend now has:
  - explicit route constants
  - model normalization helpers
  - startup model preload (`HUMMER_PRELOAD_MODEL`)

## Percussion Module Target Layout
- Keep melody module intact.
- Add a dedicated percussion page and script:
  - `percussion.html`
  - `percussion.js`
- Keep shared low-level helpers in `audio-core.js`.
- Add backend endpoint for percussion inference, separate from melody:
  - proposed: `POST /api/percussion-track`

## Contract Guidelines for New Modules
- Frontend modules should own their own state and DOM bindings.
- Shared logic goes into:
  - `audio-core.js` for math/audio helpers
  - backend helper functions in `server.py` (or split module files later if size grows)
- API responses should include:
  - model metadata (`model`, `device`, decoder/settings)
  - per-frame or per-event confidence values
  - timing arrays in seconds

## Next Refactor Trigger
- When `app.js` exceeds practical maintainability for melody-only work, split it into:
  - `melody-ui.js`
  - `melody-analysis.js`
  - `melody-playback.js`
  using the same `HummerCore` shared layer.
