# The Gathering of Lanterns — Teia mint bundle

Offline interactive OBJKT for [teia.art/mint](https://teia.art/mint).

## Local test

```bash
cd nft
python3 -m http.server 8000
```

Open `http://localhost:8000`, click the canvas to focus, then use arrow keys to pan.

## Zip for upload

```bash
cd nft
zip -r ../nft.zip . -x "*.DS_Store"
```

Upload `nft.zip` at teia.art/mint. Use fields from `metadata.txt`.

## Notes

- `script.js` has no network code (exhibition WebSocket/ESP32 stack stays on `main`).
- `thumbnail.png` is the project metadata cover; replace with a still from the live sketch if preferred.
- Teia passes optional `?creator=` and `?viewer=` query params (read in `script.js`).
