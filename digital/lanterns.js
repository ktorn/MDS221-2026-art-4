const PALETTE = ["#87adc7", "#e7d77c", "#bf541d", "#90a484", "#d5809e"];

const CONFIG = {
  maxLanterns: 65,
  spawnIntervalMin: 0.24,
  spawnIntervalMax: 0.62,
  cameraAccel: 860,
  cameraDamping: 5.4
};

let scene;
let bgImage;

function preload() {
  // Fail-safe: ensure preload completes even if the image can't be loaded
  // (e.g. when running from file:// without a local server).
  bgImage = loadImage(
    "assets/2.jpg",
    () => {},
    () => {
      bgImage = null;
    }
  );
}

function setup() {
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.id("scene");
  pixelDensity(clampValue(window.devicePixelRatio || 1, 1, 2));
  scene = new Scene();
}

function draw() {
  const dt = min(0.033, deltaTime / 1000);
  scene.update(dt);
  scene.draw();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pixelDensity(clampValue(window.devicePixelRatio || 1, 1, 2));
}

class Scene {
  constructor() {
    this.time = 0;
    this.camera = new CameraRig();
    this.system = new LanternSystem(this.camera);
  }

  update(dt) {
    this.time += dt;
    this.camera.update(dt);
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

  update(dt) {
    const leftPressed = keyIsDown(LEFT_ARROW);
    const rightPressed = keyIsDown(RIGHT_ARROW);
    const input = (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0);

    this.velocityX += input * CONFIG.cameraAccel * dt;
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

    for (let i = 0; i < 20; i++) {
      const depth = pow(random(), 1.7);
      this.lanterns.push(Lantern.create(depth, random(-40, width + 40), random(height * 0.05, height * 1.08)));
    }
  }

  update(dt, time) {
    this.spawnTimer += dt;
    while (this.spawnTimer >= this.nextSpawnIn) {
      this.spawnTimer -= this.nextSpawnIn;
      this.nextSpawnIn = randRange(CONFIG.spawnIntervalMin, CONFIG.spawnIntervalMax);
      if (this.lanterns.length < CONFIG.maxLanterns) {
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
        this.lanterns.splice(i, 1);
      }
    }

    this.lanterns.sort((a, b) => a.depth - b.depth);
  }

  draw(time) {
    for (const lantern of this.lanterns) {
      lantern.draw(time, this.camera.offsetX);
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
    const glow = this.glowBase + this.glowAmp * pulse;
    const w = this.bodyW * this.scale;
    const h = this.bodyH * this.scale;
    const parallax = lerp(0.22, 1.3, this.depth);
    const drawXRaw = this.baseX + cameraOffsetX * parallax;
    const drawX = wrapValue(drawXRaw, -220, width + 220);
    const drawY = this.y;
    const ctx = drawingContext;

    push();
    translate(drawX, drawY);

    ctx.save();
    ctx.globalAlpha = this.alpha;

    const outerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, glow * (0.6 + this.depth * 0.8));
    outerGlow.addColorStop(0, hexToRgba(this.glowColor, 0.14 + pulse * 0.16));
    outerGlow.addColorStop(0.5, hexToRgba(this.bodyColor, 0.08 + pulse * 0.08));
    outerGlow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = outerGlow;
    noStroke();
    circle(0, 0, glow * (0.8 + this.depth * 0.6) * 2);

    const bodyGrad = ctx.createLinearGradient(0, -h * 0.72, 0, h * 0.82);
    bodyGrad.addColorStop(0, hexToRgba(this.bodyColor, 0.98));
    bodyGrad.addColorStop(0.52, hexToRgba(this.glowColor, 0.92));
    bodyGrad.addColorStop(1, hexToRgba(this.frameColor, 0.95));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    // Make top ~2x wider than bottom.
    const topHalf = w * 0.86;
    const bottomHalf = w * 0.36;
    ctx.moveTo(-topHalf, -h * 0.56);
    ctx.quadraticCurveTo(-w * 1.06, -h * 0.04, -bottomHalf, h * 0.63);
    ctx.quadraticCurveTo(0, h * 0.83, bottomHalf, h * 0.63);
    ctx.quadraticCurveTo(w * 1.06, -h * 0.04, topHalf, -h * 0.56);
    ctx.quadraticCurveTo(0, -h * 0.91, -topHalf, -h * 0.56);
    ctx.closePath();
    ctx.fill();

    stroke(hexToRgba(this.frameColor, 0.72));
    strokeWeight(max(1, w * 0.05));
    noFill();
    for (let i = -1; i <= 1; i++) {
      const x = i * topHalf * 0.42;
      beginShape();
      vertex(x, -h * 0.58);
      quadraticVertex(x * 0.86, 0, x, h * 0.68);
      endShape();
    }

    noStroke();
    fill(hexToRgba(this.glowColor, 0.55 + pulse * 0.24));
    ellipse(0, -h * 0.24, topHalf * 1.25, h * 0.2);

    stroke(hexToRgba(this.frameColor, 0.7));
    strokeWeight(max(1, w * 0.03));
    line(-bottomHalf * 0.65, h * 0.58, bottomHalf * 0.65, h * 0.58);

    stroke(hexToRgba(this.frameColor, 0.66));
    strokeWeight(max(1, w * 0.02));
    noFill();
    beginShape();
    vertex(-w * 0.18, h * 0.58);
    quadraticVertex(-w * 0.16, h * 0.76, -w * 0.22, h * 0.95);
    endShape();
    beginShape();
    vertex(0, h * 0.58);
    quadraticVertex(0, h * 0.77, 0, h * 1.02);
    endShape();
    beginShape();
    vertex(w * 0.18, h * 0.58);
    quadraticVertex(w * 0.16, h * 0.76, w * 0.22, h * 0.95);
    endShape();

    noStroke();
    fill(hexToRgba(this.tasselColor, 0.9));
    ellipse(-w * 0.22, h * 0.97, w * 0.096, h * 0.15);
    ellipse(0, h * 1.03, w * 0.1, h * 0.16);
    ellipse(w * 0.22, h * 0.97, w * 0.096, h * 0.15);

    const flameGrad = ctx.createRadialGradient(0, h * 0.62, 0, 0, h * 0.62, this.flame * this.scale * 2.2);
    flameGrad.addColorStop(0, hexToRgba(this.glowColor, 0.96));
    flameGrad.addColorStop(0.45, hexToRgba(this.bodyColor, 0.86));
    flameGrad.addColorStop(1, hexToRgba(this.bodyColor, 0));
    ctx.fillStyle = flameGrad;
    ctx.beginPath();
    ctx.ellipse(0, h * 0.62, this.flame * this.scale, this.flame * this.scale * 1.7, 0, 0, TWO_PI);
    ctx.fill();

    ctx.restore();
    pop();
  }
}

function drawBackground(time, cameraOffsetX = 0) {
  background("#0a0a10");
  const ctx = drawingContext;

  // 360 pan-friendly background: tile the image horizontally and scroll with camera offset.
  if (bgImage && bgImage.width > 1) {
    const scale = height / bgImage.height;
    const drawW = bgImage.width * scale;
    const drawH = height;

    const parallax = 0.18;
    const scroll = cameraOffsetX * parallax;
    const startX = -(((scroll % drawW) + drawW) % drawW);

    noSmooth();
    for (let x = startX - drawW; x < width + drawW; x += drawW) {
      image(bgImage, x, 0, drawW, drawH);
    }
    smooth();
  }

  // Subtle darken + vignette so lantern glow reads clearly.
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
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
