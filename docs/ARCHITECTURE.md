# Hummer Architecture

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
  - static route: `/percussion` -> `percussion.html`

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

## Percussion Module Layout
- Melody module remains intact (`index.html` + `app.js`).
- Percussion module is isolated to:
  - `percussion.html`
  - `percussion.js`
- Percussion analysis is currently client-side:
  - onset detection and gating are handled locally
  - hit class assignment uses user calibration prototypes (up to 3 per class)
  - prototype data persists in browser `localStorage`
- Shared low-level helpers remain in `audio-core.js`.

## Module Guidelines
- Frontend modules should own their own state and DOM bindings.
- Shared logic goes into:
  - `audio-core.js` for math/audio helpers
  - backend helper functions in `server.py` for server-resident inference paths
- If/when percussion moves server-side, keep onset and classification contracts separate so they can be tuned independently.

## Next Refactor Trigger
- When `app.js` exceeds practical maintainability for melody-only work, split it into:
  - `melody-ui.js`
  - `melody-analysis.js`
  - `melody-playback.js`
  using the same `HummerCore` shared layer.
