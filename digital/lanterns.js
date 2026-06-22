const PALETTE = ["#87adc7", "#e7d77c", "#bf541d", "#90a484", "#d5809e"];

const CONFIG = {
  maxLanterns: 50,
  minDynamicMaxLanterns: 10,
  spawnIntervalMin: 0.28,
  spawnIntervalMax: 0.72,
  cameraAccel: 860,
  cameraDamping: 5.4,
  backgroundParallax: 0.18,
  simpleLanternDepthBelow: 0.42,
  panSmoothing: 11,
  spritePulseFrames: 6
};

const TARGET_FPS = 60;

const APP_SECRETS = window.APP_SECRETS || {};
const REGISTRY_BASE_URL =
  APP_SECRETS.registryBaseUrl || "https://esp-device-registry.xxx.workers.dev";
const DEFAULT_DEVICE_ID = APP_SECRETS.deviceId || "MDS221-2026-4";
const PAN_STALE_MS = 500;
const PAN_DISCONNECT_MS = 1200;
const FPS_SAMPLE_MS = 500;
const BACKGROUND_IMAGE_URL = "assets/2.jpg";
const BACKGROUND_RETRY_MS = 2000;

let fpsDisplay = 0;
let fpsFrameCount = 0;
let fpsWindowStartMs = 0;
let spawnScale = 1;

function readUrlConfig() {
  const params = new URLSearchParams(window.location.search);
  return {
    deviceId: params.get("deviceId") || DEFAULT_DEVICE_ID,
    token: params.get("token") || APP_SECRETS.registryToken || null,
    registry: params.get("registry") || REGISTRY_BASE_URL,
    ws: params.get("ws"),
    wsHost: params.get("wsHost"),
    wsPort: params.get("wsPort") || "81",
  };
}

function hasDirectWs(config) {
  return !!(config.ws || config.wsHost);
}

function needsRegistryLookup(config) {
  return !hasDirectWs(config) && !!(config.deviceId && config.token);
}

async function lookupDeviceEndpoint(config) {
  const base = config.registry.replace(/\/$/, "");
  const url = new URL(`${base}/lookup`);
  url.searchParams.set("device_id", config.deviceId);
  url.searchParams.set("token", config.token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`lookup ${res.status}`);
  }
  const data = await res.json();
  if (!data.lan_ip) throw new Error("no lan_ip");
  const port = data.ws_port || 81;
  return `ws://${data.lan_ip}:${port}`;
}

class PanWebSocket {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.latest = null;
    this.lastRawHeading = null;
    this.unwrappedHeading = null;
    this.lastReceivedMs = 0;
    this.errorState = null;
    this.wantConnection = false;
    this.reconnectTimer = null;
    this.lastDisplayedState = "";
  }

  ingestHeading(rawHeading) {
    const heading = clampValue(rawHeading, 0, 359.99);
    this.latest = heading;

    if (this.lastRawHeading === null || this.unwrappedHeading === null) {
      this.lastRawHeading = heading;
      this.unwrappedHeading = heading;
      return;
    }

    let delta = heading - this.lastRawHeading;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;

    this.unwrappedHeading += delta;
    this.lastRawHeading = heading;
  }

  setUrl(url) {
    const wasConnected = this.wantConnection;
    this.disconnect();
    this.url = url;
    if (wasConnected) this.connect();
  }

  connect() {
    this.wantConnection = true;
    this.openSocket();
  }

  openSocket() {
    if (this.socket && this.socket.readyState <= 1) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.socket = new WebSocket(this.url);
    this.errorState = null;
    this.lastReceivedMs = 0;
    this.latest = null;
    this.lastRawHeading = null;
    this.unwrappedHeading = null;
    this.notifyStateChange();

    this.socket.onopen = () => {
      this.notifyStateChange();
    };
    this.socket.onclose = () => {
      this.socket = null;
      this.notifyStateChange();
      if (this.wantConnection) {
        this.reconnectTimer = setTimeout(() => this.openSocket(), 2000);
      }
    };
    this.socket.onerror = () => {
      this.errorState = "error";
      this.notifyStateChange();
    };

    // ESP32 heading stream: {"heading": 123.45, "source": "esp32", "ts": 1760000000000}
    this.socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (typeof payload.heading !== "number") return;
        this.errorState = null;
        this.lastReceivedMs = Date.now();
        this.ingestHeading(payload.heading);
        this.notifyStateChange();
      } catch (err) {
        this.errorState = "bad_data";
        this.notifyStateChange();
      }
    };
  }

  disconnect() {
    this.wantConnection = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.latest = null;
    this.lastRawHeading = null;
    this.unwrappedHeading = null;
    this.lastReceivedMs = 0;
    this.errorState = null;
    this.lastDisplayedState = "";
    this.notifyStateChange();
  }

  isStale() {
    if (this.lastReceivedMs === 0) return true;
    return Date.now() - this.lastReceivedMs > PAN_STALE_MS;
  }

  getDataAgeMs() {
    if (this.lastReceivedMs === 0) return null;
    return Date.now() - this.lastReceivedMs;
  }

  getHeading() {
    if (this.isStale() || typeof this.latest !== "number") return null;
    return this.latest;
  }

  getUnwrappedHeading() {
    if (this.isStale() || typeof this.unwrappedHeading !== "number") return null;
    return this.unwrappedHeading;
  }

  getState() {
    if (!this.wantConnection) return "disconnected";
    if (this.errorState) return this.errorState;
    if (!this.socket) {
      return this.reconnectTimer ? "reconnecting" : "disconnected";
    }

    const readyState = this.socket.readyState;
    if (readyState === WebSocket.CONNECTING) return "connecting";
    if (readyState === WebSocket.CLOSING) return "closing";
    if (readyState === WebSocket.CLOSED) return "disconnected";
    if (this.lastReceivedMs === 0) return "waiting";
    if (this.isStale()) return "stale";
    return "connected";
  }

  tick() {
    if (!this.wantConnection) return;

    const ageMs = this.getDataAgeMs();
    if (
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      ageMs !== null &&
      ageMs > PAN_DISCONNECT_MS
    ) {
      this.socket.close();
      return;
    }

    this.notifyStateChange();
  }

  notifyStateChange() {
    const next = this.getState();
    if (next === this.lastDisplayedState) return;
    this.lastDisplayedState = next;
    updateHint(true);
  }
}

const URL_CONFIG = readUrlConfig();
let WS_URL = hasDirectWs(URL_CONFIG)
  ? URL_CONFIG.ws || `ws://${URL_CONFIG.wsHost}:${URL_CONFIG.wsPort}`
  : needsRegistryLookup(URL_CONFIG)
    ? "resolving…"
    : "ws://localhost:8080";
let registryState = needsRegistryLookup(URL_CONFIG)
  ? "resolving"
  : hasDirectWs(URL_CONFIG)
    ? "bypassed"
    : "no token";

let panSource = "websocket";
let panInput;
let hintEl;
let debugVisible = true;
let scene;
let bgImage;
let bgTileLayer;
let bgOverlayLayer;
let bgLoadState = "idle";
let bgLastLoadAttemptMs = 0;
const rgbaCache = new Map();

function preload() {
  requestBackgroundImage();
}

function setup() {
  panInput = new PanWebSocket(WS_URL);
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.id("scene");
  pixelDensity(1);
  prepareBackgroundLayers();
  scene = new Scene();
  hintEl = document.querySelector(".hint");
  updateHint(true);

  if (needsRegistryLookup(URL_CONFIG)) {
    lookupDeviceEndpoint(URL_CONFIG)
      .then((url) => {
        WS_URL = url;
        panInput.setUrl(url);
        registryState = "ok";
        if (panSource === "websocket") {
          panInput.connect();
        }
        updateHint(true);
      })
      .catch((err) => {
        registryState = err.message || "failed";
        updateHint(true);
      });
  } else if (hasDirectWs(URL_CONFIG)) {
    registryState = "bypassed";
    panInput.connect();
    updateHint(true);
  } else if (panSource === "websocket") {
    panInput.connect();
    updateHint(true);
  }
}

function draw() {
  ensureBackgroundReady();
  updateFps();
  updateSpawnScale();
  const dt = min(0.033, deltaTime / 1000);
  if (panSource === "websocket" && panInput) {
    panInput.tick();
  }
  scene.update(dt);
  scene.draw();
  if (frameCount % 4 === 0) {
    updateHint();
  }
}

function updateFps() {
  const now = millis();
  if (fpsWindowStartMs === 0) {
    fpsWindowStartMs = now;
    return;
  }

  fpsFrameCount++;
  const elapsed = now - fpsWindowStartMs;
  if (elapsed < FPS_SAMPLE_MS) return;

  fpsDisplay = (fpsFrameCount * 1000) / elapsed;
  fpsFrameCount = 0;
  fpsWindowStartMs = now;
}

function updateSpawnScale() {
  if (fpsDisplay <= 0) return;

  const target = clampValue(fpsDisplay / TARGET_FPS, 0.2, 1);
  const rate = target < spawnScale ? 0.22 : 0.07;
  spawnScale = lerp(spawnScale, target, rate);
}

function getDynamicSpawnLimits() {
  const scale = max(0.2, spawnScale);
  return {
    maxLanterns: max(
      CONFIG.minDynamicMaxLanterns,
      floor(CONFIG.maxLanterns * scale)
    ),
    intervalMin: CONFIG.spawnIntervalMin / scale,
    intervalMax: CONFIG.spawnIntervalMax / scale,
  };
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  prepareBackgroundLayers();
}

function keyPressed() {
  if (key === "w" || key === "W") {
    togglePanSource();
  } else if (key === "f" || key === "F") {
    fullscreen(!fullscreen());
  } else if (key === "d" || key === "D") {
    toggleDebugPane();
  }
}

function toggleDebugPane() {
  debugVisible = !debugVisible;
  if (hintEl) {
    hintEl.style.display = debugVisible ? "block" : "none";
  }
  updateHint(true);
}

function togglePanSource() {
  panSource = panSource === "simulation" ? "websocket" : "simulation";
  if (panSource === "websocket") {
    panInput.connect();
  } else {
    panInput.disconnect();
  }
  updateHint(true);
}

function updateHint(force = false) {
  if (!hintEl || !panInput) return;
  if (!debugVisible) return;
  if (!force && frameCount % 4 !== 0) return;
  const wsState = panSource === "websocket" ? panInput.getState() : "idle";
  const dataAge = panSource === "websocket" ? panInput.getDataAgeMs() : null;
  const heading = panSource === "websocket" ? panInput.getHeading() : null;
  const dataLabel =
    dataAge === null ? "no data yet" : `${(dataAge / 1000).toFixed(1)}s ago`;
  const headingLabel =
    heading === null ? "--" : `${heading.toFixed(2)}°`;
  const fpsLabel = fpsDisplay > 0 ? fpsDisplay.toFixed(1) : "--";
  const spawnCap = getDynamicSpawnLimits().maxLanterns;
  const bgLabel = bgTileLayer ? "ready" : bgLoadState;
  hintEl.textContent =
    `FPS: ${fpsLabel} | Spawn cap: ${spawnCap} | BG: ${bgLabel} | Source: ${panSource} | WS: ${wsState} | Heading: ${headingLabel} | Data: ${dataLabel} | Endpoint: ${WS_URL} | Registry: ${registryState} | W: source | F: fullscreen | D: debug`;
}

class Scene {
  constructor() {
    this.time = 0;
    this.camera = new CameraRig();
    this.system = new LanternSystem(this.camera);
  }

  update(dt) {
    this.time += dt;
    const headingDeg = panSource === "websocket" ? panInput.getUnwrappedHeading() : null;
    this.camera.update(dt, headingDeg);
    this.system.update(dt, this.time);
  }

  draw() {
    drawBackground(this.time, this.camera.offsetX);
    this.system.draw(this.time);
  }
}

class CameraRig {
  constructor() {
    this.offsetX = 0;
    this.velocityX = 0;
  }

  update(dt, headingDeg = null) {
    if (panSource === "websocket" && headingDeg !== null) {
      const tileW = getBackgroundTileWidth();
      const travel = tileW / CONFIG.backgroundParallax;
      const targetOffsetX = (headingDeg / 360) * travel;
      const smooth = 1 - exp(-CONFIG.panSmoothing * dt);
      this.offsetX = lerp(this.offsetX, targetOffsetX, smooth);
      this.velocityX = 0;
      return;
    }

    const leftPressed = keyIsDown(LEFT_ARROW);
    const rightPressed = keyIsDown(RIGHT_ARROW);
    const keyboardInput = (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0);

    this.velocityX += keyboardInput * CONFIG.cameraAccel * dt;
    const damping = exp(-CONFIG.cameraDamping * dt);
    this.velocityX *= damping;
    this.offsetX += this.velocityX * dt;
  }
}

class LanternSystem {
  constructor(camera) {
    this.camera = camera;
    this.lanterns = [];
    this.spawnTimer = 0;
    this.nextSpawnIn = randRange(CONFIG.spawnIntervalMin, CONFIG.spawnIntervalMax);

    for (let i = 0; i < 14; i++) {
      const depth = pow(random(), 1.7);
      this.lanterns.push(Lantern.create(depth, random(-40, width + 40), random(height * 0.05, height * 1.08)));
    }
  }

  update(dt, time) {
    const spawnLimits = getDynamicSpawnLimits();

    this.spawnTimer += dt;
    while (this.spawnTimer >= this.nextSpawnIn) {
      this.spawnTimer -= this.nextSpawnIn;
      this.nextSpawnIn = randRange(spawnLimits.intervalMin, spawnLimits.intervalMax);
      if (this.lanterns.length < spawnLimits.maxLanterns) {
        const depth = pow(random(), 1.8);
        const spawnX = random(-90, width + 90);
        const spawnY = height + random(20, 120);
        this.lanterns.push(Lantern.create(depth, spawnX, spawnY));
      }
    }

    for (let i = this.lanterns.length - 1; i >= 0; i--) {
      const lantern = this.lanterns[i];
      lantern.update(dt, time);
      if (lantern.isOutOfView()) {
        if (this.lanterns.length > spawnLimits.maxLanterns) {
          lantern.dispose();
          this.lanterns.splice(i, 1);
        } else {
          lantern.respawn();
        }
      }
    }

    if (frameCount % 3 === 0) {
      this.lanterns.sort((a, b) => a.depth - b.depth);
    }
  }

  draw(time) {
    const cameraOffsetX = this.camera.offsetX;
    for (const lantern of this.lanterns) {
      lantern.draw(time, cameraOffsetX);
    }
  }
}

class Lantern {
  static create(depth, x, y) {
    const size = lerp(18, 68, depth);
    return new Lantern({
      x,
      y,
      depth,
      scale: lerp(0.52, 1.28, depth),
      riseSpeed: lerp(18, 76, depth),
      driftAmpX: lerp(5, 28, depth),
      driftAmpY: lerp(2, 12, depth),
      driftFreq: randRange(0.2, 0.68),
      phase: random(TWO_PI),
      alpha: lerp(0.35, 1, depth),
      bodyColor: random(PALETTE),
      glowColor: random(PALETTE),
      tasselColor: random(PALETTE),
      frameColor: random(PALETTE),
      glowBase: size * randRange(0.8, 1.3),
      glowAmp: randRange(3.5, 12),
      breatheFreq: randRange(1.0, 2.1),
      bodyW: size * randRange(0.72, 0.9),
      bodyH: size * randRange(1.2, 1.55),
      flame: randRange(2.8, 5.4)
    });
  }

  constructor(props) {
    Object.assign(this, props);
    this.baseX = props.x;
    this.baseY = props.y;
    this.sprites = [];
    this.spriteW = 0;
    this.spriteH = 0;
  }

  respawn() {
    this.baseX = random(-90, width + 90);
    this.baseY = height + random(20, 120);
    this.y = this.baseY;
    this.phase = random(TWO_PI);
  }

  dispose() {
    for (const sprite of this.sprites) {
      if (sprite && typeof sprite.remove === "function") {
        sprite.remove();
      }
    }
    this.sprites = [];
    this.spriteW = 0;
    this.spriteH = 0;
  }

  usesSimpleSprite() {
    return this.depth < CONFIG.simpleLanternDepthBelow;
  }

  getSpriteBounds() {
    const w = this.bodyW * this.scale;
    const h = this.bodyH * this.scale;
    const maxGlow = this.glowBase + this.glowAmp;
    const glowRadius = this.usesSimpleSprite()
      ? maxGlow * 1.1
      : maxGlow * (0.8 + this.depth * 0.6);
    const pad = 14;
    return {
      halfW: max(w * 1.15, glowRadius) + pad,
      halfH: max(h * 1.15, glowRadius) + pad,
    };
  }

  buildSpriteCache() {
    const bounds = this.getSpriteBounds();
    this.spriteW = ceil(bounds.halfW * 2);
    this.spriteH = ceil(bounds.halfH * 2);
    const frames = CONFIG.spritePulseFrames;
    this.sprites = [];

    for (let i = 0; i < frames; i++) {
      const pulse = frames === 1 ? 0.5 : i / (frames - 1);
      const sprite = createGraphics(this.spriteW, this.spriteH);
      sprite.pixelDensity(1);
      sprite.clear();
      sprite.push();
      sprite.translate(this.spriteW / 2, this.spriteH / 2);
      if (this.usesSimpleSprite()) {
        this.paintSimple(sprite, pulse);
      } else {
        this.paintDetailed(sprite, pulse);
      }
      sprite.pop();
      this.sprites.push(sprite);
    }
  }

  update(dt, time) {
    const sideDrift = sin(time * this.driftFreq + this.phase) * this.driftAmpX;
    this.baseX += sideDrift * dt * 0.35;
    this.baseY -= this.riseSpeed * dt;
    this.y = this.baseY + sin(time * (this.driftFreq * 0.9) + this.phase) * this.driftAmpY;

    const horizontalWrapPadding = 140;
    if (this.baseX < -horizontalWrapPadding) {
      this.baseX = width + horizontalWrapPadding;
    } else if (this.baseX > width + horizontalWrapPadding) {
      this.baseX = -horizontalWrapPadding;
    }
  }

  isOutOfView() {
    return this.baseY < -220;
  }

  draw(time, cameraOffsetX) {
    const pulse = sin(time * this.breatheFreq + this.phase) * 0.5 + 0.5;
    const parallax = lerp(0.22, 1.3, this.depth);
    const drawXRaw = this.baseX + cameraOffsetX * parallax;
    const drawX = wrapValue(drawXRaw, -220, width + 220);
    const drawY = this.y;

    if (drawX < -300 || drawX > width + 300 || drawY < -280 || drawY > height + 180) {
      return;
    }

    if (!this.sprites.length) {
      this.buildSpriteCache();
    }
    if (!this.sprites.length) return;

    const frameIndex = min(
      floor(pulse * (this.sprites.length - 1)),
      this.sprites.length - 1
    );

    imageMode(CENTER);
    image(this.sprites[frameIndex], drawX, drawY);
    imageMode(CORNER);
  }

  paintDetailed(g, pulse) {
    const glow = this.glowBase + this.glowAmp * pulse;
    const w = this.bodyW * this.scale;
    const h = this.bodyH * this.scale;
    const ctx = g.drawingContext;

    ctx.save();
    ctx.globalAlpha = this.alpha;

    const outerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, glow * (0.6 + this.depth * 0.8));
    outerGlow.addColorStop(0, hexToRgba(this.glowColor, 0.14 + pulse * 0.16));
    outerGlow.addColorStop(0.5, hexToRgba(this.bodyColor, 0.08 + pulse * 0.08));
    outerGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = outerGlow;
    g.noStroke();
    g.circle(0, 0, glow * (0.8 + this.depth * 0.6) * 2);

    const bodyGrad = ctx.createLinearGradient(0, -h * 0.72, 0, h * 0.82);
    bodyGrad.addColorStop(0, hexToRgba(this.bodyColor, 0.98));
    bodyGrad.addColorStop(0.52, hexToRgba(this.glowColor, 0.92));
    bodyGrad.addColorStop(1, hexToRgba(this.frameColor, 0.95));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    const topHalf = w * 0.86;
    const bottomHalf = w * 0.36;
    ctx.moveTo(-topHalf, -h * 0.56);
    ctx.quadraticCurveTo(-w * 1.06, -h * 0.04, -bottomHalf, h * 0.63);
    ctx.quadraticCurveTo(0, h * 0.83, bottomHalf, h * 0.63);
    ctx.quadraticCurveTo(w * 1.06, -h * 0.04, topHalf, -h * 0.56);
    ctx.quadraticCurveTo(0, -h * 0.91, -topHalf, -h * 0.56);
    ctx.closePath();
    ctx.fill();

    g.stroke(hexToRgba(this.frameColor, 0.72));
    g.strokeWeight(max(1, w * 0.05));
    g.noFill();
    for (let i = -1; i <= 1; i++) {
      const x = i * topHalf * 0.42;
      g.beginShape();
      g.vertex(x, -h * 0.58);
      g.quadraticVertex(x * 0.86, 0, x, h * 0.68);
      g.endShape();
    }

    g.noStroke();
    g.fill(hexToRgba(this.glowColor, 0.55 + pulse * 0.24));
    g.ellipse(0, -h * 0.24, topHalf * 1.25, h * 0.2);

    g.stroke(hexToRgba(this.frameColor, 0.7));
    g.strokeWeight(max(1, w * 0.03));
    g.line(-bottomHalf * 0.65, h * 0.58, bottomHalf * 0.65, h * 0.58);

    g.stroke(hexToRgba(this.frameColor, 0.66));
    g.strokeWeight(max(1, w * 0.02));
    g.noFill();
    g.beginShape();
    g.vertex(-w * 0.18, h * 0.58);
    g.quadraticVertex(-w * 0.16, h * 0.76, -w * 0.22, h * 0.95);
    g.endShape();
    g.beginShape();
    g.vertex(0, h * 0.58);
    g.quadraticVertex(0, h * 0.77, 0, h * 1.02);
    g.endShape();
    g.beginShape();
    g.vertex(w * 0.18, h * 0.58);
    g.quadraticVertex(w * 0.16, h * 0.76, w * 0.22, h * 0.95);
    g.endShape();

    g.noStroke();
    g.fill(hexToRgba(this.tasselColor, 0.9));
    g.ellipse(-w * 0.22, h * 0.97, w * 0.096, h * 0.15);
    g.ellipse(0, h * 1.03, w * 0.1, h * 0.16);
    g.ellipse(w * 0.22, h * 0.97, w * 0.096, h * 0.15);

    const flameGrad = ctx.createRadialGradient(0, h * 0.62, 0, 0, h * 0.62, this.flame * this.scale * 2.2);
    flameGrad.addColorStop(0, hexToRgba(this.glowColor, 0.96));
    flameGrad.addColorStop(0.45, hexToRgba(this.bodyColor, 0.86));
    flameGrad.addColorStop(1, hexToRgba(this.bodyColor, 0));
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.ellipse(0, h * 0.62, this.flame * this.scale, this.flame * this.scale * 1.7, 0, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
  }

  paintSimple(g, pulse) {
    const glow = this.glowBase + this.glowAmp * pulse;
    const w = this.bodyW * this.scale;
    const h = this.bodyH * this.scale;
    const ctx = g.drawingContext;

    ctx.save();
    ctx.globalAlpha = this.alpha;

    const outerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, glow * 1.1);
    outerGlow.addColorStop(0, hexToRgba(this.glowColor, 0.16 + pulse * 0.12));
    outerGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = outerGlow;
    g.noStroke();
    g.circle(0, 0, glow * 1.8);

    g.fill(hexToRgba(this.bodyColor, 0.9));
    g.ellipse(0, 0, w * 0.82, h * 0.95);
    g.fill(hexToRgba(this.glowColor, 0.75 + pulse * 0.15));
    g.ellipse(0, h * 0.58, w * 0.22, h * 0.12);

    ctx.restore();
  }
}

function requestBackgroundImage() {
  if (bgLoadState === "loading") return;

  bgLoadState = "loading";
  bgLastLoadAttemptMs = Date.now();

  bgImage = loadImage(
    BACKGROUND_IMAGE_URL,
    (loadedImage) => {
      bgImage = loadedImage;
      bgLoadState = "loaded";
      prepareBackgroundLayers();
      updateHint(true);
    },
    () => {
      bgImage = null;
      bgTileLayer = null;
      bgOverlayLayer = null;
      bgLoadState = "failed";
      updateHint(true);
    }
  );
}

function ensureBackgroundReady() {
  if (bgTileLayer && bgOverlayLayer) return;

  if (bgImage && bgImage.width > 1 && width > 0 && height > 0) {
    prepareBackgroundLayers();
    return;
  }

  if (
    bgLoadState !== "loading" &&
    Date.now() - bgLastLoadAttemptMs > BACKGROUND_RETRY_MS
  ) {
    bgLoadState = "retrying";
    requestBackgroundImage();
  }
}

function prepareBackgroundLayers() {
  if (!bgImage || bgImage.width <= 1 || width < 1 || height < 1) {
    disposeBackgroundLayers();
    return;
  }

  disposeBackgroundLayers();

  const drawW = Math.ceil(bgImage.width * (height / bgImage.height));
  bgTileLayer = createGraphics(drawW, height);
  bgTileLayer.pixelDensity(1);
  bgTileLayer.noSmooth();
  bgTileLayer.image(bgImage, 0, 0, drawW, height);

  bgOverlayLayer = createGraphics(width, height);
  bgOverlayLayer.pixelDensity(1);
  const ctx = bgOverlayLayer.drawingContext;

  const shade = ctx.createLinearGradient(0, 0, 0, height);
  shade.addColorStop(0, "rgba(0,0,0,0.22)");
  shade.addColorStop(0.6, "rgba(0,0,0,0.18)");
  shade.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    min(width, height) * 0.18,
    width * 0.5,
    height * 0.52,
    max(width, height) * 0.78
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  bgLoadState = "ready";
}

function disposeBackgroundLayers() {
  if (bgTileLayer && typeof bgTileLayer.remove === "function") {
    bgTileLayer.remove();
  }
  if (bgOverlayLayer && typeof bgOverlayLayer.remove === "function") {
    bgOverlayLayer.remove();
  }
  bgTileLayer = null;
  bgOverlayLayer = null;
}

function drawBackground(time, cameraOffsetX = 0) {
  background("#0a0a10");

  if (bgTileLayer) {
    const drawW = bgTileLayer.width;
    const scroll = -cameraOffsetX * CONFIG.backgroundParallax;
    const startX = -(((scroll % drawW) + drawW) % drawW);

    noSmooth();
    for (let x = startX - drawW; x < width + drawW; x += drawW) {
      image(bgTileLayer, x, 0);
    }
    smooth();
  }

  if (bgOverlayLayer) {
    image(bgOverlayLayer, 0, 0);
  }
}

function getBackgroundTileWidth() {
  if (bgTileLayer) return bgTileLayer.width;
  if (!bgImage || bgImage.width <= 1) return width;
  return bgImage.width * (height / bgImage.height);
}

function randRange(minValue, maxValue) {
  return minValue + random() * (maxValue - minValue);
}

function clampValue(value, minValue, maxValue) {
  return max(minValue, min(maxValue, value));
}

function wrapValue(value, minValue, maxValue) {
  const range = maxValue - minValue;
  if (range <= 0) {
    return value;
  }
  return ((value - minValue) % range + range) % range + minValue;
}

function hexToRgba(hex, alpha = 1) {
  const key = `${hex}|${alpha}`;
  if (rgbaCache.has(key)) return rgbaCache.get(key);

  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const value = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  rgbaCache.set(key, value);
  return value;
}
