"use strict";

const creator = new URLSearchParams(window.location.search).get("creator");
const viewer = new URLSearchParams(window.location.search).get("viewer");

const PALETTE = ["#87adc7", "#e7d77c", "#bf541d", "#90a484", "#d5809e"];

const CONFIG = {
  maxLanterns: 50,
  minDynamicMaxLanterns: 10,
  spawnIntervalMin: 0.28,
  spawnIntervalMax: 0.72,
  cameraAccel: 860,
  cameraDamping: 5.4,
  autoDriftAccel: 120,
  backgroundParallax: 0.18,
  simpleLanternDepthBelow: 0.42,
  spritePulseFrames: 6
};

const SPAWN_THROTTLE_FPS = 30;
const FPS_SAMPLE_MS = 500;
const BACKGROUND_IMAGE_URL = "assets/2.jpg";
const BACKGROUND_RETRY_MS = 2000;

let fpsDisplay = 0;
let fpsFrameCount = 0;
let fpsWindowStartMs = 0;
let spawnScale = 1;
let autoDriftEnabled = true;
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
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  prepareBackgroundLayers();
  scene = new Scene();
}

function draw() {
  ensureBackgroundReady();
  updateFps();
  updateSpawnScale();
  const dt = min(0.033, deltaTime / 1000);
  scene.update(dt);
  scene.draw();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pixelDensity(1);
  prepareBackgroundLayers();
}

function keyPressed() {
  if (key === " ") {
    autoDriftEnabled = !autoDriftEnabled;
    return false;
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

  if (fpsDisplay >= SPAWN_THROTTLE_FPS) {
    spawnScale = 1;
    return;
  }

  const target = clampValue(fpsDisplay / SPAWN_THROTTLE_FPS, 0.2, 1);
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

class Scene {
  constructor() {
    this.time = 0;
    this.camera = new CameraRig();
    this.system = new LanternSystem(this.camera);
  }

  update(dt) {
    this.time += dt;
    this.camera.update(dt, this.time);
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
    this.autoPhase = random(TWO_PI);
  }

  update(dt, time) {
    const leftPressed = keyIsDown(LEFT_ARROW);
    const rightPressed = keyIsDown(RIGHT_ARROW);
    const keyboardInput = (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0);

    if (keyboardInput !== 0) {
      this.velocityX += keyboardInput * CONFIG.cameraAccel * dt;
    } else if (autoDriftEnabled) {
      const drift = sin(time * 0.11 + this.autoPhase) * 0.22 + 0.38;
      this.velocityX += drift * CONFIG.autoDriftAccel * dt;
    }

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
      this.lanterns.push(
        Lantern.create(depth, random(-40, width + 40), random(height * 0.05, height * 1.08))
      );
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
    },
    () => {
      bgImage = null;
      bgTileLayer = null;
      bgOverlayLayer = null;
      bgLoadState = "failed";
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
