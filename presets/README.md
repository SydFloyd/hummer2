# Shared Presets

This folder contains shared preset files for the Audio-to-MIDI Lab.

## How Shared Presets Work

1. Add your preset JSON file to this folder (for example: `my-vocal.json`).
2. Register it in `presets/index.json` under the `presets` array.
3. Commit and push both files.

The app loads `presets/index.json` and fetches each preset file by path.

## Preset File Shape

```json
{
  "schemaVersion": 1,
  "name": "My Preset",
  "description": "Optional notes",
  "createdAt": "2026-03-04T00:00:00.000Z",
  "owner": { "type": "shared", "id": "public" },
  "settings": { "...": "..." }
}
```

## Future User Accounts

The `owner` object is intentionally included now so the same preset schema can support account-based storage later:

- Shared preset today: `"owner": { "type": "shared", "id": "public" }`
- User preset later: `"owner": { "type": "user", "id": "<user-id>" }`

With accounts, the UI can still use the same `settings` payload while loading/saving from an authenticated API instead of local files.
