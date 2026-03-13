# Percussion Debug Assets

Optional local fixtures for Percussion Lab:

1. Prototype snapshot:
`/assets/debug/percussion-prototypes.json`

Expected shape:

```json
{
  "version": 1,
  "prototypes": {
    "0": [{ "vector": [0.1, 0.2], "capturedAt": 0, "frameIndex": 0, "strength": 0.5 }],
    "1": [],
    "2": []
  }
}
```

Use the UI button `Load Debug Prototypes` to fetch that file.

2. Optional future regression clips can also live in this folder.
