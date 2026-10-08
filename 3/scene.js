import { LOGOS, PALETTE, STROKES } from "./constants.js";

const TAU = Math.PI * 2;
const PARTY_PULSE_INTERVAL = 0.72;
const PARTY_FREQUENCY = 0.5;
const ROLL_WIND_UP_DURATION = 0.38;
const ROLL_FALL_RATIO = 0.32;
const ROLL_REST_DURATION = 0.07;
const POLONAISE_SIDESTEP_SPEED = 1.22;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

function rollTiming(speed = 1, variation = 1, fallRatio = ROLL_FALL_RATIO) {
  const windUp = ROLL_WIND_UP_DURATION * variation / Math.max(speed, 0.05);
  const fall = windUp * fallRatio;
  const rest = ROLL_REST_DURATION;
  return { windUp, fall, rest, duration: windUp + fall + rest };
}

function rollPhase(elapsed, timing) {
  if (elapsed <= 0) return 0;
  if (elapsed < timing.windUp) {
    const progress = elapsed / timing.windUp;
    return progress * progress * 0.5;
  }
  if (elapsed < timing.windUp + timing.fall) {
    const progress = (elapsed - timing.windUp) / timing.fall;
    const initialSlope = timing.fall / timing.windUp;
    const acceleration = 0.5 - initialSlope;
    return 0.5 + initialSlope * progress + acceleration * progress ** 2;
  }
  return 1;
}

function letterGravityScale(glyph) {
  const character = glyph.toLocaleLowerCase("nl");
  const multipliers = {
    i: 0.68, j: 0.74, l: 0.72,
    f: 0.86, r: 0.88, t: 0.84,
    m: 1.18, w: 1.22,
    g: 1.08, q: 1.08, y: 1.06,
  };
  return multipliers[character] ?? 1;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export class Scene {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.state = state;
    this.assets = new Map();
    this.tintCache = new Map();
    this.confetti = [];
    this.party = [];
    this.partyGrid = null;
    this.partyPulseElapsed = 0;
    this.partyPulseIndex = 0;
    this.polonaiseLines = [];
    this.polonaiseSidestepRequest = 0;
    this.polonaiseDragIndex = null;
    this.polonaiseDragStart = null;
    this.time = 0;
    this.lastTime = performance.now();
    this.running = false;
    this.pointer = { down: false, x: 0, y: 0 };
  }

  async init() {
    const allAssets = [...LOGOS, ...STROKES];
    await Promise.all(allAssets.map(async (asset) => {
      const image = await loadImage(asset.src);
      this.assets.set(asset.src, image);
    }));
    await document.fonts.ready;
    this.resize(this.state.width, this.state.height);
    this.reset();
    this.running = true;
    requestAnimationFrame((time) => this.loop(time));
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.tintCache.clear();
    this.reset();
  }

  reset() {
    this.time = 0;
    this.polonaiseLines = [];
    this.polonaiseSidestepRequest = 0;
    this.polonaiseDragIndex = null;
    this.polonaiseDragStart = null;
    this.createConfetti();
    this.createParty();
  }

  modeChanged() {
    if (this.state.mode === "confetti" && !this.confetti.length) this.createConfetti();
    if (this.state.mode === "party") this.createParty();
  }

  createConfetti() {
    const { width, height } = this.state;
    const glyphs = [...this.state.confetti.text.toLocaleLowerCase("nl")].filter((char) => char.trim());
    const base = Math.min(width, height) * 0.064 * this.state.contentScale * this.state.confetti.size;
    this.ctx.font = `600 ${base * 1.85}px Saans`;
    this.confetti = glyphs.map((glyph) => {
      const halfWidth = Math.max(base * 0.2, this.ctx.measureText(glyph).width * 0.48);
      const halfHeight = base * 0.72;
      return {
        type: "letter", glyph, size: base, halfWidth, halfHeight,
        radius: Math.hypot(halfWidth, halfHeight),
        x: randomBetween(base, width - base),
        y: randomBetween(-height * 0.25, height * 0.78),
        vx: randomBetween(-width, width) * 0.035,
        vy: randomBetween(-height, height) * 0.025,
        angle: randomBetween(0, TAU), spin: randomBetween(-2.1, 2.1),
        gravityScale: letterGravityScale(glyph),
        restitution: randomBetween(0.1, 0.2), color: this.state.foreground,
      };
    });
    this.confetti.forEach((particle) => this.prepareRigidBody(particle));
  }

  createParty() {
    const { width, height } = this.state;
    const size = Math.min(width, height) * 0.105 * this.state.contentScale;
    const margin = size * 0.3;
    const usableWidth = Math.max(size, width - margin * 2);
    const usableHeight = Math.max(size, height - margin * 2);
    const logoSpacing = size + margin;
    const cols = Math.max(1, Math.floor((usableWidth + margin) / logoSpacing));
    const rows = Math.max(1, Math.floor((usableHeight + margin) / logoSpacing));
    const spacingX = cols > 1 ? logoSpacing : 0;
    const spacingY = rows > 1 ? logoSpacing : 0;
    const gridWidth = size + Math.max(0, cols - 1) * spacingX;
    const gridHeight = size + Math.max(0, rows - 1) * spacingY;
    const originX = (width - gridWidth) * 0.5 + size * 0.5;
    const originY = (height - gridHeight) * 0.5 + size * 0.5;
    this.partyGrid = { margin, size, cols, rows, spacingX, spacingY, originX, originY };
    this.partyPulseElapsed = 0;
    this.partyPulseIndex = 0;
    const cells = [];
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) cells.push({ col, row });
    for (let index = cells.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [cells[index], cells[swap]] = [cells[swap], cells[index]];
    }
    const count = Math.min(this.state.party.count, Math.max(1, cells.length - 1));
    this.party = cells.slice(0, count).map((cell, index) => {
      const baseAngle = (index % 2) * Math.PI * 0.5;
      return {
      col: cell.col, row: cell.row,
      fromCol: cell.col, fromRow: cell.row, toCol: cell.col, toRow: cell.row,
      progress: 1, duration: 1,
      angle: baseAngle, startAngle: baseAngle, targetAngle: baseAngle,
      seed: randomBetween(0, 100), logo: this.pickLogo(index), size,
      colorIndex: index,
      };
    });
  }

  syncConfetti() { this.createConfetti(); }
  syncParty() { this.createParty(); }

  recolorParty() {
    this.party.forEach((item, index) => { item.colorIndex = index; });
  }

  resetPolonaiseLines() {
    this.polonaiseLines = [];
    this.polonaiseSidestepRequest = 0;
  }

  queuePolonaiseSidestep() { this.polonaiseSidestepRequest += 1; }

  setPolonaiseLineCount(count) {
    const lineCount = clamp(Math.round(count), 1, 5);
    this.state.polonaise.lineCount = lineCount;
    this.state.polonaise.linePositions = Array.from({ length: lineCount }, (_, index) => (index + 1) / (lineCount + 1));
    this.state.polonaise.lineOffsets = Array.from({ length: lineCount }, () => 0);
    this.resetPolonaiseLines();
  }

  polonaiseGeometry() {
    const { width, height } = this.state;
    const horizontal = this.state.polonaise.direction === "left" || this.state.polonaise.direction === "right";
    const crossLength = horizontal ? height : width;
    const initialLaneGap = crossLength / 5;
    const size = Math.min(initialLaneGap * 0.82, Math.min(width, height) * 0.21) * this.state.contentScale;
    const margin = size * 0.42;
    const minCenter = margin + size * 0.5;
    const maxCenter = Math.max(minCenter, crossLength - margin - size * 0.5);
    const count = this.state.polonaise.lineCount;
    if (this.state.polonaise.linePositions.length !== count || this.state.polonaise.lineOffsets.length !== count) this.setPolonaiseLineCount(count);
    const centers = this.state.polonaise.linePositions.map((position) => minCenter + clamp(position, 0, 1) * (maxCenter - minCenter));
    return { horizontal, crossLength, size, margin, minCenter, maxCenter, centers };
  }

  beginPolonaiseDrag(x, y) {
    const geometry = this.polonaiseGeometry();
    const crossPosition = geometry.horizontal ? y : x;
    let closestIndex = 0;
    let closestDistance = Infinity;
    geometry.centers.forEach((center, index) => {
      const distance = Math.abs(center - crossPosition);
      if (distance < closestDistance) { closestDistance = distance; closestIndex = index; }
    });
    this.polonaiseDragIndex = closestIndex;
    this.polonaiseDragStart = {
      x, y,
      offset: this.state.polonaise.lineOffsets[closestIndex],
    };
    return true;
  }

  dragPolonaiseLine(x, y) {
    if (this.polonaiseDragIndex === null) return;
    const geometry = this.polonaiseGeometry();
    const crossPosition = geometry.horizontal ? y : x;
    const span = Math.max(1, geometry.maxCenter - geometry.minCenter);
    this.state.polonaise.linePositions[this.polonaiseDragIndex] = clamp((crossPosition - geometry.minCenter) / span, 0, 1);
    const alongDelta = geometry.horizontal ? x - this.polonaiseDragStart.x : y - this.polonaiseDragStart.y;
    this.state.polonaise.lineOffsets[this.polonaiseDragIndex] = this.polonaiseDragStart.offset + alongDelta;
  }

  endPolonaiseDrag() { this.polonaiseDragIndex = null; this.polonaiseDragStart = null; }

  pickLogo(index = 0, selection = this.state.party.logo) {
    if (selection !== "variation") return LOGOS.find((logo) => logo.id === selection) || LOGOS[0];
    return LOGOS[((index % LOGOS.length) + LOGOS.length) % LOGOS.length];
  }

  allowedColors() {
    const excluded = new Set(this.state.excludedColors);
    if (this.state.mode === "confetti") {
      excluded.add(this.state.foreground);
      excluded.add(this.state.background);
    }
    const allowed = PALETTE.filter((color) => !excluded.has(color));
    return allowed.length ? allowed : [this.state.foreground];
  }

  recolorStrokes() {
    const colors = this.allowedColors();
    for (const particle of this.confetti) {
      if (particle.type !== "stroke") continue;
      particle.color = this.state.varyColors
        ? colors[Math.floor(Math.random() * colors.length)]
        : this.state.foreground;
    }
  }

  prepareRigidBody(particle) {
    const area = Math.max(1, particle.halfWidth * particle.halfHeight * 4);
    const referenceArea = Math.max(1, particle.size * particle.size);
    particle.mass = Math.max(0.4, area / referenceArea);
    particle.invMass = 1 / particle.mass;
    const width = particle.halfWidth * 2; const height = particle.halfHeight * 2;
    particle.inertia = particle.mass * (width * width + height * height) / 12;
    particle.invInertia = 1 / Math.max(particle.inertia, 1);
    particle.stableFrames = 0;
    particle.asleep = false;
    particle.hadContact = false;
    particle.sideBoundaryContact = false;
  }

  addStroke(x, y) {
    const base = Math.min(this.state.width, this.state.height) * 0.042 * this.state.contentScale * this.state.confetti.size;
    const colors = this.allowedColors();
    const direction = randomBetween(0, TAU);
    const force = randomBetween(0.07, 0.13) * Math.min(this.state.width, this.state.height);
    const particle = {
      type: "stroke", asset: STROKES[Math.floor(Math.random() * STROKES.length)],
      x, y,
      vx: Math.cos(direction) * force, vy: Math.sin(direction) * force,
      size: base, halfWidth: base * 0.23, halfHeight: base * 1.28,
      radius: Math.hypot(base * 0.23, base * 1.28),
      collisionMargin: base * 0.06,
      gravityScale: 1, supportedGravityScale: 0.32,
      angle: direction, spin: randomBetween(-2.2, 2.2), restitution: 0.14,
      color: this.state.varyColors ? colors[Math.floor(Math.random() * colors.length)] : this.state.foreground,
    };
    this.prepareRigidBody(particle);
    this.confetti.push(particle);
    while (this.confetti.filter((item) => item.type === "stroke").length > 100) {
      const oldestStrokeIndex = this.confetti.findIndex((item) => item.type === "stroke");
      if (oldestStrokeIndex < 0) break;
      this.confetti.splice(oldestStrokeIndex, 1);
    }
  }

  applyForce(x, y, strength = 1) {
    const range = Math.hypot(this.state.width, this.state.height) * 0.58;
    const forceScale = 0.2 + this.state.confetti.force * 1.4;
    for (const particle of this.confetti) {
      const dx = particle.x - x;
      const dy = particle.y - y;
      const distance = Math.hypot(dx, dy) || 1;
      const surfaceDistance = Math.max(0, distance - particle.radius);
      if (surfaceDistance > range) continue;
      const falloff = 0.2 + (1 - surfaceDistance / range) * 0.8;
      const impulse = falloff * range * 6.2 * strength * forceScale;
      let impulseX = (dx / distance) * impulse;
      let impulseY = (dy / distance) * impulse;
      const wallBuffer = particle.radius * 0.35;
      const atLeftWall = particle.x - particle.radius <= wallBuffer;
      const atRightWall = this.state.width - particle.x - particle.radius <= wallBuffer;
      const atTopWall = particle.y - particle.radius <= wallBuffer;
      const atBottomWall = this.state.height - particle.y - particle.radius <= wallBuffer;
      if ((atLeftWall && impulseX < 0) || (atRightWall && impulseX > 0)) impulseX *= 0.08;
      if ((atTopWall && impulseY < 0) || (atBottomWall && impulseY > 0)) impulseY *= 0.08;
      particle.asleep = false;
      particle.stableFrames = 0;
      particle.vx += impulseX;
      particle.vy += impulseY;
      particle.spin += randomBetween(-3.6, 3.6) * strength * forceScale;
      this.limitParticleSpeed(particle);
    }
  }

  limitParticleSpeed(particle) {
    const maxSpeed = Math.hypot(this.state.width, this.state.height) * 2.4;
    const speed = Math.hypot(particle.vx, particle.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / speed;
      particle.vx *= scale;
      particle.vy *= scale;
    }
    particle.spin = clamp(particle.spin, -9, 9);
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 0.033);
    this.lastTime = now;
    this.time += dt;
    this.render(dt);
    requestAnimationFrame((time) => this.loop(time));
  }

  render(dt = 1 / 60) {
    this.ctx.fillStyle = this.state.background;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.state.mode === "confetti") this.renderConfetti(dt);
    if (this.state.mode === "polonaise") this.renderPolonaise(dt);
    if (this.state.mode === "party") this.renderParty(dt);
  }

  updateConfetti(dt) {
    const { width, height } = this.state;
    const gravity = height * 0.5325;
    const sleepSpeed = Math.min(width, height) * 0.018;
    for (const particle of this.confetti) {
      particle.hadContact = false;
      particle.sideBoundaryContact = false;
      particle.supported = false;
      if (particle.asleep) continue;
      const gravityScale = particle.wasSupported
        ? (particle.supportedGravityScale ?? particle.gravityScale ?? 1)
        : (particle.gravityScale ?? 1);
      particle.vy += gravity * gravityScale * dt;
      particle.vx *= Math.pow(0.998, dt * 60);
      particle.vy *= Math.pow(0.998, dt * 60);
      particle.spin *= Math.pow(0.996, dt * 60);
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.angle += particle.spin * dt;
      this.constrainParticle(particle, width, height);
    }
    // A deeper pile needs more passes to carry pressure through every layer.
    // Scaling the solver avoids bottom-layer compression without making the
    // small, common confetti setup needlessly expensive.
    const solverPasses = Math.min(22, 8 + Math.floor(this.confetti.length / 7));
    for (let pass = 0; pass < solverPasses; pass += 1) {
      this.resolveCollisions();
      for (const particle of this.confetti) this.constrainParticle(particle, width, height);
    }
    for (const particle of this.confetti) {
      particle.wasSupported = particle.supported;
      if (particle.asleep) continue;
      this.limitParticleSpeed(particle);
      const linearSpeed = Math.hypot(particle.vx, particle.vy);
      const edgeSpeed = Math.abs(particle.spin) * particle.radius;
      if (particle.hadContact && !particle.sideBoundaryContact && linearSpeed < sleepSpeed * 4 && edgeSpeed < sleepSpeed * 4) {
        const contactDamping = particle.type === "stroke" ? 0.8 : 0.86;
        const spinDamping = particle.type === "stroke" ? 0.64 : 0.74;
        particle.vx *= contactDamping; particle.vy *= contactDamping; particle.spin *= spinDamping;
      }
      if (particle.hadContact && !particle.sideBoundaryContact && linearSpeed < sleepSpeed && edgeSpeed < sleepSpeed) particle.stableFrames += 1;
      else particle.stableFrames = 0;
      if (particle.stableFrames > 12) {
        particle.vx = 0; particle.vy = 0; particle.spin = 0;
        particle.asleep = true;
      }
    }
  }

  constrainParticle(particle, width, height) {
    const halfWidth = particle.halfWidth + (particle.collisionMargin || 0);
    const halfHeight = particle.halfHeight + (particle.collisionMargin || 0);
    const cos = Math.cos(particle.angle); const sin = Math.sin(particle.angle);
    const extentX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfHeight;
    const extentY = Math.abs(sin) * halfWidth + Math.abs(cos) * halfHeight;
    if (particle.x < extentX) {
      particle.sideBoundaryContact = true;
      this.resolveBoundaryContact(particle, 1, 0, extentX - particle.x);
    }
    if (particle.x > width - extentX) {
      particle.sideBoundaryContact = true;
      this.resolveBoundaryContact(particle, -1, 0, particle.x + extentX - width);
    }
    if (particle.y < extentY) this.resolveBoundaryContact(particle, 0, 1, extentY - particle.y);
    if (particle.y > height - extentY) this.resolveBoundaryContact(particle, 0, -1, particle.y + extentY - height);
  }

  supportPoint(particle, dx, dy) {
    const halfWidth = particle.halfWidth + (particle.collisionMargin || 0);
    const halfHeight = particle.halfHeight + (particle.collisionMargin || 0);
    const ux = Math.cos(particle.angle); const uy = Math.sin(particle.angle);
    const vx = -uy; const vy = ux;
    const projectionX = ux * dx + uy * dy; const projectionY = vx * dx + vy * dy;
    const localX = Math.abs(projectionX) < 0.00001 ? 0 : Math.sign(projectionX) * halfWidth;
    const localY = Math.abs(projectionY) < 0.00001 ? 0 : Math.sign(projectionY) * halfHeight;
    return { x: particle.x + ux * localX + vx * localY, y: particle.y + uy * localX + vy * localY };
  }

  contactVelocity(particle, rx, ry) {
    return { x: particle.vx - particle.spin * ry, y: particle.vy + particle.spin * rx };
  }

  applyBodyImpulse(particle, ix, iy, rx, ry) {
    if (particle.asleep) {
      const wakeThreshold = particle.mass * Math.min(this.state.width, this.state.height) * 0.02;
      if (Math.hypot(ix, iy) < wakeThreshold) return;
      particle.asleep = false;
      particle.stableFrames = 0;
    }
    particle.vx += ix * particle.invMass;
    particle.vy += iy * particle.invMass;
    particle.spin += (rx * iy - ry * ix) * particle.invInertia;
  }

  resolveBoundaryContact(particle, nx, ny, penetration) {
    particle.hadContact = true;
    if (ny < -0.35) particle.supported = true;
    particle.x += nx * penetration;
    particle.y += ny * penetration;
    const contact = this.supportPoint(particle, -nx, -ny);
    const rx = contact.x - particle.x; const ry = contact.y - particle.y;
    const velocity = this.contactVelocity(particle, rx, ry);
    const normalSpeed = velocity.x * nx + velocity.y * ny;
    if (normalSpeed >= 0) {
      particle.spin *= 0.86;
      return;
    }
    const crossNormal = rx * ny - ry * nx;
    const denominator = particle.invMass + crossNormal * crossNormal * particle.invInertia;
    const restingThreshold = Math.min(this.state.width, this.state.height) * 0.04;
    const restitution = Math.abs(normalSpeed) < restingThreshold ? 0 : particle.restitution;
    const normalImpulse = -(1 + restitution) * normalSpeed / Math.max(denominator, 0.0001);
    this.applyBodyImpulse(particle, nx * normalImpulse, ny * normalImpulse, rx, ry);
    const tx = -ny; const ty = nx;
    const afterNormal = this.contactVelocity(particle, rx, ry);
    const tangentSpeed = afterNormal.x * tx + afterNormal.y * ty;
    const crossTangent = rx * ty - ry * tx;
    const tangentDenominator = particle.invMass + crossTangent * crossTangent * particle.invInertia;
    const frictionImpulse = clamp(-tangentSpeed / Math.max(tangentDenominator, 0.0001), -normalImpulse * 0.62, normalImpulse * 0.62);
    this.applyBodyImpulse(particle, tx * frictionImpulse, ty * frictionImpulse, rx, ry);
    particle.spin *= 0.82;
  }

  resolveCollisions() {
    const largestDiameter = this.confetti.reduce((largest, particle) => {
      const collisionRadius = particle.radius + (particle.collisionMargin || 0) * Math.SQRT2;
      return Math.max(largest, collisionRadius * 2);
    }, 24);
    const cellSize = largestDiameter;
    const grid = new Map();
    this.confetti.forEach((particle, index) => {
      const key = `${Math.floor(particle.x / cellSize)},${Math.floor(particle.y / cellSize)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(index);
    });
    const checked = new Set();
    for (const [key, indices] of grid) {
      const [gx, gy] = key.split(",").map(Number);
      const nearby = [];
      for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) nearby.push(...(grid.get(`${gx + ox},${gy + oy}`) || []));
      for (const firstIndex of indices) for (const secondIndex of nearby) {
        if (firstIndex >= secondIndex) continue;
        const pairKey = `${firstIndex}:${secondIndex}`;
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);
        const a = this.confetti[firstIndex]; const b = this.confetti[secondIndex];
        const collision = this.rectangleCollision(a, b);
        if (!collision) continue;
        a.hadContact = true; b.hadContact = true;
        const { nx, ny, overlap } = collision;
        if (ny > 0.35) a.supported = true;
        if (ny < -0.35) b.supported = true;
        if (a.asleep && b.asleep) continue;

        // Treat sleeping bodies as fixed supports during positional correction.
        // That prevents a settled pile from being nudged back and forth by the
        // small overlap corrections of newly arriving confetti.
        const correctionInvMassA = a.asleep ? 0 : a.invMass;
        const correctionInvMassB = b.asleep ? 0 : b.invMass;
        const correctionInvMassSum = correctionInvMassA + correctionInvMassB;
        const correction = Math.max(overlap - 0.08, 0) * 0.9 / Math.max(correctionInvMassSum, 0.0001);
        a.x -= nx * correction * correctionInvMassA; a.y -= ny * correction * correctionInvMassA;
        b.x += nx * correction * correctionInvMassB; b.y += ny * correction * correctionInvMassB;

        const invMassSum = a.invMass + b.invMass;

        const pointA = this.supportPoint(a, nx, ny);
        const pointB = this.supportPoint(b, -nx, -ny);
        const contactX = (pointA.x + pointB.x) * 0.5; const contactY = (pointA.y + pointB.y) * 0.5;
        const raX = contactX - a.x; const raY = contactY - a.y;
        const rbX = contactX - b.x; const rbY = contactY - b.y;
        const velocityA = this.contactVelocity(a, raX, raY);
        const velocityB = this.contactVelocity(b, rbX, rbY);
        const relativeX = velocityB.x - velocityA.x; const relativeY = velocityB.y - velocityA.y;
        const normalSpeed = relativeX * nx + relativeY * ny;
        if (normalSpeed >= 0) continue;

        const raCrossN = raX * ny - raY * nx; const rbCrossN = rbX * ny - rbY * nx;
        const normalDenominator = invMassSum + raCrossN * raCrossN * a.invInertia + rbCrossN * rbCrossN * b.invInertia;
        const restingThreshold = Math.min(this.state.width, this.state.height) * 0.04;
        const restitution = Math.abs(normalSpeed) < restingThreshold ? 0 : Math.min(a.restitution, b.restitution);
        const normalImpulse = -(1 + restitution) * normalSpeed / Math.max(normalDenominator, 0.0001);
        this.applyBodyImpulse(a, -nx * normalImpulse, -ny * normalImpulse, raX, raY);
        this.applyBodyImpulse(b, nx * normalImpulse, ny * normalImpulse, rbX, rbY);

        const tx = -ny; const ty = nx;
        const afterA = this.contactVelocity(a, raX, raY); const afterB = this.contactVelocity(b, rbX, rbY);
        const tangentSpeed = (afterB.x - afterA.x) * tx + (afterB.y - afterA.y) * ty;
        const raCrossT = raX * ty - raY * tx; const rbCrossT = rbX * ty - rbY * tx;
        const tangentDenominator = invMassSum + raCrossT * raCrossT * a.invInertia + rbCrossT * rbCrossT * b.invInertia;
        const frictionImpulse = clamp(-tangentSpeed / Math.max(tangentDenominator, 0.0001), -normalImpulse * 0.55, normalImpulse * 0.55);
        this.applyBodyImpulse(a, -tx * frictionImpulse, -ty * frictionImpulse, raX, raY);
        this.applyBodyImpulse(b, tx * frictionImpulse, ty * frictionImpulse, rbX, rbY);
      }
    }
  }

  rectangleCollision(a, b) {
    const axes = [
      { x: Math.cos(a.angle), y: Math.sin(a.angle) },
      { x: -Math.sin(a.angle), y: Math.cos(a.angle) },
      { x: Math.cos(b.angle), y: Math.sin(b.angle) },
      { x: -Math.sin(b.angle), y: Math.cos(b.angle) },
    ];
    const dx = b.x - a.x; const dy = b.y - a.y;
    let smallestOverlap = Infinity; let normal = axes[0];
    for (const axis of axes) {
      const distance = Math.abs(dx * axis.x + dy * axis.y);
      const aX = Math.cos(a.angle); const aY = Math.sin(a.angle);
      const bX = Math.cos(b.angle); const bY = Math.sin(b.angle);
      const aHalfWidth = a.halfWidth + (a.collisionMargin || 0); const aHalfHeight = a.halfHeight + (a.collisionMargin || 0);
      const bHalfWidth = b.halfWidth + (b.collisionMargin || 0); const bHalfHeight = b.halfHeight + (b.collisionMargin || 0);
      const radiusA = Math.abs(axis.x * aX + axis.y * aY) * aHalfWidth + Math.abs(axis.x * -aY + axis.y * aX) * aHalfHeight;
      const radiusB = Math.abs(axis.x * bX + axis.y * bY) * bHalfWidth + Math.abs(axis.x * -bY + axis.y * bX) * bHalfHeight;
      const overlap = radiusA + radiusB - distance;
      if (overlap <= 0) return null;
      if (overlap < smallestOverlap) { smallestOverlap = overlap; normal = axis; }
    }
    const direction = dx * normal.x + dy * normal.y < 0 ? -1 : 1;
    return { nx: normal.x * direction, ny: normal.y * direction, overlap: smallestOverlap };
  }

  renderConfetti(dt) {
    this.updateConfetti(dt);
    for (const particle of this.confetti) {
      this.ctx.save();
      this.ctx.translate(particle.x, particle.y);
      this.ctx.rotate(particle.angle);
      if (particle.type === "letter") {
        this.ctx.fillStyle = this.state.foreground;
        this.ctx.font = `600 ${particle.size * 1.85}px Saans`;
        this.ctx.textAlign = "center"; this.ctx.textBaseline = "middle";
        this.ctx.fillText(particle.glyph.toLocaleLowerCase("nl"), 0, 0);
      } else {
        const image = this.getTinted(particle.asset, particle.color, "stroke");
        this.ctx.drawImage(image, -particle.halfWidth, -particle.halfHeight, particle.halfWidth * 2, particle.halfHeight * 2);
      }
      this.ctx.restore();
    }
  }

  advancePolonaise(dt, settings, lineIndex) {
    if (!this.polonaiseLines[lineIndex]) {
      this.polonaiseLines[lineIndex] = {
        step: 0,
        beatTime: 0,
        motion: "forward",
        pendingSidesteps: 0,
        seenSidestepRequest: 0,
      };
    }
    const runtime = this.polonaiseLines[lineIndex];
    const newRequests = this.polonaiseSidestepRequest - runtime.seenSidestepRequest;
    if (newRequests > 0) {
      runtime.pendingSidesteps += newRequests;
      runtime.seenSidestepRequest = this.polonaiseSidestepRequest;
    }
    runtime.beatTime += dt;
    let timing = rollTiming(settings.speed * (runtime.motion === "backward" ? POLONAISE_SIDESTEP_SPEED : 1));
    while (runtime.beatTime >= timing.duration) {
      runtime.beatTime -= timing.duration;
      if (runtime.motion === "backward") {
        runtime.step -= 1;
        runtime.motion = "forward";
      } else {
        runtime.step += 1;
        if (runtime.pendingSidesteps > 0) {
          runtime.pendingSidesteps -= 1;
          runtime.motion = "backward";
        }
      }
      timing = rollTiming(settings.speed * (runtime.motion === "backward" ? POLONAISE_SIDESTEP_SPEED : 1));
    }
    return {
      step: runtime.step,
      phase: rollPhase(runtime.beatTime, timing),
      movementDirection: runtime.motion === "backward" ? -1 : 1,
    };
  }

  tumbleStep(start, floor, size, horizontal, sign, step, phase, orientationSign = sign) {
    const half = size * 0.5;
    let pivotX; let pivotY; let vectorX; let vectorY; let rotation;
    if (horizontal) {
      pivotX = start + sign * half; pivotY = floor;
      vectorX = -sign * half; vectorY = -half;
      rotation = sign * phase * Math.PI * 0.5;
    } else {
      pivotX = floor; pivotY = start + sign * half;
      vectorX = -half; vectorY = -sign * half;
      rotation = -sign * phase * Math.PI * 0.5;
    }
    const cos = Math.cos(rotation); const sin = Math.sin(rotation);
    return {
      x: pivotX + vectorX * cos - vectorY * sin,
      y: pivotY + vectorX * sin + vectorY * cos,
      angle: ((horizontal ? orientationSign : -orientationSign) * step + (horizontal ? sign : -sign) * phase) * Math.PI * 0.5,
    };
  }

  renderPolonaise(dt) {
    const { width, height } = this.state;
    const settings = this.state.polonaise;
    const geometry = this.polonaiseGeometry();
    const { horizontal, size, margin, centers } = geometry;
    const travelLength = horizontal ? width : height;
    const spacing = size + margin;
    const colors = this.allowedColors();

    centers.forEach((center, lineIndex) => {
      const beat = this.advancePolonaise(dt, settings, lineIndex);
      let sign = settings.direction === "right" || settings.direction === "down" ? 1 : -1;
      if (settings.alternating && lineIndex % 2) sign *= -1;
      const completedOffset = sign * beat.step * size + settings.lineOffsets[lineIndex];
      const movementSign = sign * beat.movementDirection;
      const firstIndex = Math.floor((-size - completedOffset) / spacing) - 2;
      const lastIndex = Math.ceil((travelLength + size - completedOffset) / spacing) + 2;
      for (let index = firstIndex; index <= lastIndex; index += 1) {
        const start = index * spacing + completedOffset;
        const floor = center + size * 0.5;
        const position = this.tumbleStep(start, floor, size, horizontal, movementSign, beat.step, beat.phase, sign);
        if (horizontal && (position.x < -size || position.x > width + size)) continue;
        if (!horizontal && (position.y < -size || position.y > height + size)) continue;
        const asset = this.pickLogo(index + lineIndex * 3, settings.logo);
        const alternatingRotation = ((index + lineIndex) & 1) * Math.PI * 0.5;
        const colorIndex = ((index + lineIndex * 2) % colors.length + colors.length) % colors.length;
        const color = this.state.varyColors ? colors[colorIndex] : this.state.foreground;
        this.drawLogo(asset, position.x, position.y, size, position.angle + alternatingRotation, color);
      }
    });
  }

  partyCellPosition(col, row) {
    const grid = this.partyGrid;
    return { x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY };
  }

  partyFieldValue(col, row, time, channel = 0) {
    const spatialScale = 1.08;
    const timeScale = 0.46;
    const first = Math.sin((col * 0.73 + row * 0.31) * spatialScale + time * timeScale + channel * 2.17);
    const second = Math.cos((row * 0.67 - col * 0.21) * spatialScale - time * timeScale * 0.63 + channel * 1.31);
    return clamp(0.5 + (first + second) * 0.25, 0, 1);
  }

  partyMotion(item, settings) {
    const influence = clamp(settings.noise, 0, 1);
    const speedNoise = (this.partyFieldValue(item.col, item.row, this.time) - 0.5) * 2;
    const localSpeed = clamp(settings.speed + speedNoise * influence, 0.05, 1);
    return { timing: rollTiming(0.25 + localSpeed * 0.75), frequency: PARTY_FREQUENCY };
  }

  partyRollChance(item, channel = 0) {
    const value = Math.sin(item.seed * 12.9898 + this.partyPulseIndex * 78.233 + channel * 37.719) * 43758.5453;
    return value - Math.floor(value);
  }

  choosePartyMove(item, occupied, reserved, timing) {
    const directions = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }];
    const directionNoise = this.partyFieldValue(item.col, item.row, this.time, 2);
    const targetAngle = directionNoise * TAU;
    directions.sort((a, b) => {
      const angleA = Math.atan2(a.dr, a.dc); const angleB = Math.atan2(b.dr, b.dc);
      const deltaA = Math.abs(Math.atan2(Math.sin(angleA - targetAngle), Math.cos(angleA - targetAngle)));
      const deltaB = Math.abs(Math.atan2(Math.sin(angleB - targetAngle), Math.cos(angleB - targetAngle)));
      return deltaA - deltaB;
    });
    const destination = directions.map(({ dc, dr }) => ({ col: item.col + dc, row: item.row + dr, dc, dr })).find((cell) => {
      if (cell.col < 0 || cell.row < 0 || cell.col >= this.partyGrid.cols || cell.row >= this.partyGrid.rows) return false;
      const key = `${cell.col},${cell.row}`;
      return !occupied.has(key) && !reserved.has(key);
    });
    if (!destination) return false;
    item.fromCol = item.col; item.fromRow = item.row;
    item.toCol = destination.col; item.toRow = destination.row;
    item.progress = 0;
    item.elapsed = 0;
    item.rollTiming = timing;
    item.duration = timing.duration;
    item.startAngle = item.angle;
    const turn = destination.dc !== 0 ? destination.dc : -destination.dr;
    item.targetAngle = item.angle + turn * Math.PI * 0.5;
    reserved.add(`${destination.col},${destination.row}`);
    return true;
  }

  renderParty(dt) {
    const settings = this.state.party;
    const colors = this.allowedColors();
    const speedScale = 0.25 + clamp(settings.speed, 0, 1) * 0.75;
    const pulseInterval = PARTY_PULSE_INTERVAL / speedScale;
    this.partyPulseElapsed += dt;
    let pulse = false;
    while (this.partyPulseElapsed >= pulseInterval) {
      this.partyPulseElapsed -= pulseInterval;
      this.partyPulseIndex += 1;
      pulse = true;
    }

    for (const item of this.party) {
      if (item.progress < 1) {
        item.elapsed = Math.min(item.duration, (item.elapsed || 0) + dt);
        item.progress = Math.min(1, item.elapsed / item.duration);
        if (item.progress >= 1) {
          item.col = item.toCol; item.row = item.toRow; item.angle = item.targetAngle;
          item.seed += 0.73;
        }
      }
    }

    if (pulse) {
      const occupied = new Set(this.party.map((item) => `${item.col},${item.row}`));
      const reserved = new Set(this.party.filter((item) => item.progress < 1).map((item) => `${item.toCol},${item.toRow}`));
      for (const item of this.party) {
        if (item.progress < 1) continue;
        const motion = this.partyMotion(item, settings);
        if (this.partyRollChance(item) < motion.frequency) {
          this.choosePartyMove(item, occupied, reserved, motion.timing);
        }
      }
    }

    for (const item of this.party) {
      const start = this.partyCellPosition(item.fromCol, item.fromRow);
      const end = this.partyCellPosition(item.toCol, item.toRow);
      const phase = item.progress >= 1 ? 1 : rollPhase(item.elapsed || 0, item.rollTiming || rollTiming(1));
      const horizontal = item.toCol !== item.fromCol;
      const sign = horizontal ? Math.sign(item.toCol - item.fromCol) : Math.sign(item.toRow - item.fromRow);
      const rolled = this.tumbleStep(
        horizontal ? start.x : start.y,
        (horizontal ? start.y : start.x) + item.size * 0.5,
        item.size,
        horizontal,
        sign || 1,
        0,
        phase,
      );
      const rollDistance = (sign || 1) * item.size;
      const travelDistance = horizontal ? end.x - start.x : end.y - start.y;
      const gapOffset = (travelDistance - rollDistance) * phase;
      const x = horizontal ? rolled.x + gapOffset : rolled.x;
      const y = horizontal ? rolled.y : rolled.y + gapOffset;
      const angle = item.startAngle + (item.targetAngle - item.startAngle) * phase;
      const colorIndex = ((item.colorIndex || 0) % colors.length + colors.length) % colors.length;
      const color = this.state.varyColors ? colors[colorIndex] : this.state.foreground;
      this.drawLogo(item.logo, x, y, item.size, angle, color);
    }
  }

  drawLogo(asset, x, y, size, angle, color) {
    const image = this.getTinted(asset, color, "logo");
    this.ctx.save(); this.ctx.translate(x, y); this.ctx.rotate(angle);
    this.ctx.drawImage(image, -size / 2, -size / 2, size, size);
    this.ctx.restore();
  }

  getTinted(asset, color, kind) {
    const key = `${asset.src}|${color}|${kind}`;
    if (this.tintCache.has(key)) return this.tintCache.get(key);
    const source = this.assets.get(asset.src);
    const side = kind === "stroke" ? 420 : 512;
    const canvas = document.createElement("canvas");
    canvas.width = kind === "stroke" ? 120 : side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-in";
    context.fillStyle = color;
    context.fillRect(0, 0, canvas.width, canvas.height);
    this.tintCache.set(key, canvas);
    return canvas;
  }
}
