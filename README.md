# MDS221-2026-art-4

Lantern depth-drift artwork with optional ESP32 pan control over WebSocket.

## Run the sketch

The interactive sketch is in `digital/index.html` (script: `digital/lanterns.js`).

### Option 1: Open directly

1. Open `digital/index.html` in your browser.
2. If browser security blocks any local file behavior, use Option 2.

### Option 2: Run with a local web server (recommended)

From the project root:

```bash
cd digital
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Pan control

- **Simulation mode** (default): use Left/Right arrow keys to pan the scene.
- **WebSocket mode**: press `W` to switch. The sketch expects pan values from an ESP32 or mock server.

Expected WebSocket message format:

```json
{ "heading": 123.45, "source": "esp32", "ts": 1760000000000 }
```

`heading` is required: compass degrees `0.00`–`359.99`. The sketch pans in real time to this angle (full 360° rotation scrolls the background one complete tiled image width).

### Local mock WebSocket server

```bash
npm install
npm run mock-ws
```

Mock server listens on `ws://localhost:8080`. Press `W` in the browser to use WebSocket mode.

### Connect to a real ESP32

1. Copy `tangible/esp32-pan-2026/secrets.example.h` to `secrets.h` and fill in WiFi + registry values.
2. Flash `tangible/esp32-pan-2026/esp32-pan-2026.ino` (Arduino IDE, ESP32-S3, USB CDC On Boot enabled).
3. ESP32 serves WebSocket on port `81` at `ws://<device-ip>:81/`.

### ESP32 LAN IP lookup (registry)

Same pattern as MDS221-2026-art-3:

1. Copy `digital/secrets.example.js` to `digital/secrets.js` (use the same `registryToken` and `deviceId` as `tangible/esp32-pan-2026/secrets.h`).
2. `digital/index.html` loads `secrets.js` before the sketch; on startup the page calls the cloud registry `/lookup` endpoint and resolves `ws://<lan_ip>:81`.
3. Press `W` to switch to WebSocket mode once the endpoint shows `Registry: ok`.

Overrides:

- URL params: `?deviceId=MDS221-2026-4&token=...`
- Direct LAN IP: `?wsHost=192.168.1.50` or `?ws=ws://192.168.1.50:81`

## Tangible / ESP32

Firmware lives in `tangible/esp32-pan-2026/`, following the MDS221-2026-art-template layout.

| File | Purpose |
|------|---------|
| `esp32-pan-2026.ino` | WiFi + WebSocket broadcaster |
| `sensor_code.h` / `sensor_code.cpp` | BNO055 compass → heading (`0.00–359.99°`) |
| `secrets.example.h` | WiFi and cloud registry config template |

### BNO055 wiring & libraries

- I2C: SDA `GPIO8`, SCL `GPIO9` (100 kHz)
- Arduino libraries: **Adafruit BNO055**, **Adafruit Unified Sensor**
- Streams absolute compass heading (`0.00–359.99°`) over WebSocket; the sketch maps this directly to horizontal pan.
