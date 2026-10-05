import { LOGOS, PALETTE, STROKES } from "./constants.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

function relativeLuminance(hex) {
  const channels = hex.replace("#", "").match(/.{2}/g).map((channel) => parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(first, second) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
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
    this.polonaiseStep = 0;
    this.polonaiseRhythmIndex = 0;
    this.polonaiseBeatTime = 0;
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
    this.polonaiseStep = 0;
    this.polonaiseRhythmIndex = 0;
    this.polonaiseBeatTime = 0;
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
      progress: 1, duration: 1, nextMoveAt: this.time + randomBetween(0, 1.2),
      angle: baseAngle, startAngle: baseAngle, targetAngle: baseAngle,
      seed: randomBetween(0, 100), logo: this.pickLogo(index), size,
      };
    });
  }

  syncConfetti() { this.createConfetti(); }
  syncParty() { this.createParty(); }

  restartPolonaiseRhythm() {
    this.polonaiseRhythmIndex = 0;
    this.polonaiseBeatTime = 0;
  }

  setPolonaiseLineCount(count) {
    const lineCount = clamp(Math.round(count), 1, 5);
    this.state.polonaise.lineCount = lineCount;
    this.state.polonaise.linePositions = Array.from({ length: lineCount }, (_, index) => (index + 1) / (lineCount + 1));
    this.state.polonaise.lineOffsets = Array.from({ length: lineCount }, () => 0);
  }

  polonaiseGeometry() {
    const { width, height } = this.state;
    const horizontal = this.state.polonaise.direction === "left" || this.state.polonaise.direction === "right";
    const crossLength = horizontal ? height : width;
    const initialLaneGap = crossLength / 5;
    const size = Math.min(initialLaneGap * 0.82, Math.min(width, height) * 0.21) * this.state.contentScale;
    const margin = size * 0.3;
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
    const background = this.state.background.toUpperCase();
    const manuallyAllowed = PALETTE.filter((color) => !this.state.excludedColors.has(color));
    const visible = manuallyAllowed.filter((color) => color.toUpperCase() !== background && contrastRatio(color, background) >= 3);
    if (visible.length) return visible;
    const fallback = manuallyAllowed
      .filter((color) => color.toUpperCase() !== background)
      .sort((first, second) => contrastRatio(second, background) - contrastRatio(first, background))[0];
    return [fallback || this.state.foreground];
  }

  recolorStrokes() {
    const colors = this.allowedColors();
    for (const particle of this.confetti) {
      if (particle.type !== "stroke") continue;
      particle.color = this.state.confetti.randomStrokeColors
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
  }

  addStroke(x, y) {
    const base = Math.min(this.state.width, this.state.height) * 0.042 * this.state.contentScale * this.state.confetti.size;
    const colors = this.allowedColors();
    const direction = randomBetween(0, TAU);
    const force = randomBetween(0.07, 0.13) * Math.min(this.state.width, this.state.height);
    const particle = {
      type: "stroke", asset: STROKES[Math.floor(Math.random() * STROKES.length)],
      x: x + Math.cos(direction) * base * 0.35, y: y + Math.sin(direction) * base * 0.35,
      vx: Math.cos(direction) * force, vy: Math.sin(direction) * force,
      size: base, halfWidth: base * 0.23, halfHeight: base * 1.28,
      radius: Math.hypot(base * 0.23, base * 1.28),
      collisionMargin: base * 0.22,
      angle: direction, spin: randomBetween(-2.2, 2.2), restitution: 0.14,
      color: this.state.confetti.randomStrokeColors ? colors[Math.floor(Math.random() * colors.length)] : this.state.foreground,
    };
    this.prepareRigidBody(particle);
    const placement = this.findStrokePlacement(particle, x, y, base, direction);
    if (placement.found) {
      particle.x = placement.x; particle.y = placement.y;
    } else {
      const oldestStrokeIndex = this.confetti.findIndex((item) => item.type === "stroke");
      if (oldestStrokeIndex >= 0) {
        const replaced = this.confetti[oldestStrokeIndex];
        particle.x = replaced.x; particle.y = replaced.y; particle.angle = replaced.angle;
        particle.vx = replaced.vx; particle.vy = replaced.vy; particle.spin = replaced.spin;
        particle.asleep = replaced.asleep; particle.stableFrames = replaced.stableFrames;
        this.confetti.splice(oldestStrokeIndex, 1);
      } else {
        particle.x = placement.x; particle.y = placement.y;
      }
    }
    this.confetti.push(particle);
    while (this.confetti.filter((item) => item.type === "stroke").length > 100) {
      const oldestStrokeIndex = this.confetti.findIndex((item) => item.type === "stroke");
      if (oldestStrokeIndex < 0) break;
      this.confetti.splice(oldestStrokeIndex, 1);
    }
  }

  findStrokePlacement(particle, x, y, base, direction) {
    let bestPosition = { x: particle.x, y: particle.y, overlap: Infinity };
    for (let attempt = 0; attempt < 72; attempt += 1) {
      if (attempt < 40) {
        const spread = base * (0.45 + attempt * 0.18);
        const candidateAngle = direction + attempt * 2.399;
        particle.x = x + Math.cos(candidateAngle) * spread;
        particle.y = y + Math.sin(candidateAngle) * spread;
      } else {
        particle.x = randomBetween(0, this.state.width);
        particle.y = randomBetween(0, this.state.height);
      }
      this.clampParticleInside(particle);
      const overlap = this.confetti.reduce((total, other) => total + (this.rectangleCollision(particle, other)?.overlap || 0), 0);
      if (overlap < bestPosition.overlap) bestPosition = { x: particle.x, y: particle.y, overlap };
      if (overlap === 0) return { x: particle.x, y: particle.y, found: true };
    }
    return { x: bestPosition.x, y: bestPosition.y, found: false };
  }

  clampParticleInside(particle) {
    const halfWidth = particle.halfWidth + (particle.collisionMargin || 0);
    const halfHeight = particle.halfHeight + (particle.collisionMargin || 0);
    const cos = Math.cos(particle.angle); const sin = Math.sin(particle.angle);
    const extentX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfHeight;
    const extentY = Math.abs(sin) * halfWidth + Math.abs(cos) * halfHeight;
    particle.x = clamp(particle.x, extentX, Math.max(extentX, this.state.width - extentX));
    particle.y = clamp(particle.y, extentY, Math.max(extentY, this.state.height - extentY));
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
      particle.asleep = false;
      particle.stableFrames = 0;
      particle.vx += (dx / distance) * impulse;
      particle.vy += (dy / distance) * impulse;
      particle.spin += randomBetween(-3.6, 3.6) * strength * forceScale;
    }
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
      if (particle.asleep) continue;
      particle.vy += gravity * dt;
      particle.vx *= Math.pow(0.998, dt * 60);
      particle.vy *= Math.pow(0.998, dt * 60);
      particle.spin *= Math.pow(0.996, dt * 60);
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.angle += particle.spin * dt;
      this.constrainParticle(particle, width, height);
    }
    for (let pass = 0; pass < 4; pass += 1) {
      this.resolveCollisions();
      for (const particle of this.confetti) this.constrainParticle(particle, width, height);
    }
    for (const particle of this.confetti) {
      if (particle.asleep) continue;
      const linearSpeed = Math.hypot(particle.vx, particle.vy);
      const edgeSpeed = Math.abs(particle.spin) * particle.radius;
      if (particle.hadContact && linearSpeed < sleepSpeed * 4 && edgeSpeed < sleepSpeed * 4) {
        particle.vx *= 0.9; particle.vy *= 0.9; particle.spin *= 0.82;
      }
      if (particle.hadContact && linearSpeed < sleepSpeed && edgeSpeed < sleepSpeed) particle.stableFrames += 1;
      else particle.stableFrames = 0;
      if (particle.stableFrames > 16) {
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
    if (particle.x < extentX) this.resolveBoundaryContact(particle, 1, 0, extentX - particle.x);
    if (particle.x > width - extentX) this.resolveBoundaryContact(particle, -1, 0, particle.x + extentX - width);
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
    particle.x += nx * penetration;
    particle.y += ny * penetration;
    const contact = this.supportPoint(particle, -nx, -ny);
    const rx = contact.x - particle.x; const ry = contact.y - particle.y;
    const velocity = this.contactVelocity(particle, rx, ry);
    const normalSpeed = velocity.x * nx + velocity.y * ny;
    if (normalSpeed >= 0) return;
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
        if (a.asleep && b.asleep) continue;
        const { nx, ny, overlap } = collision;
        const invMassSum = a.invMass + b.invMass;
        const correction = Math.max(overlap - 0.35, 0) * 0.58 / Math.max(invMassSum, 0.0001);
        a.x -= nx * correction * a.invMass; a.y -= ny * correction * a.invMass;
        b.x += nx * correction * b.invMass; b.y += ny * correction * b.invMass;

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

  rhythmPattern(type) {
    if (type === "cucaracha") return [
      { duration: 0.62, motion: 0.72 }, { duration: 0.62, motion: 0.72 }, { duration: 1.18, motion: 0.78 },
      { duration: 0.62, motion: 0.72 }, { duration: 0.62, motion: 0.72 }, { duration: 1.55, motion: 0.76 },
    ];
    if (type === "polonaise") return [{ duration: 1.12, motion: 0.76 }, { duration: 0.72, motion: 0.7 }, { duration: 0.72, motion: 0.7 }];
    if (type === "waltz") return [{ duration: 1.22, motion: 0.76 }, { duration: 0.82, motion: 0.7 }, { duration: 0.82, motion: 0.7 }];
    return [{ duration: 1, motion: 0.76 }];
  }

  advancePolonaise(dt, settings) {
    const pattern = this.rhythmPattern(settings.rhythm);
    const baseDuration = 0.48 / Math.max(settings.speed, 0.1);
    this.polonaiseBeatTime += dt;
    let beat = pattern[this.polonaiseRhythmIndex % pattern.length];
    let duration = baseDuration * beat.duration;
    while (this.polonaiseBeatTime >= duration) {
      this.polonaiseBeatTime -= duration;
      this.polonaiseStep += 1;
      this.polonaiseRhythmIndex += 1;
      beat = pattern[this.polonaiseRhythmIndex % pattern.length];
      duration = baseDuration * beat.duration;
    }
    const timeline = this.polonaiseBeatTime / Math.max(duration, 0.001);
    const activePhase = clamp(timeline / beat.motion, 0, 1);
    const eased = 1 - Math.cos(activePhase * Math.PI * 0.5);
    return { step: this.polonaiseStep, phase: eased };
  }

  tumbleStep(start, floor, size, horizontal, sign, step, phase) {
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
      angle: (horizontal ? sign : -sign) * (step + phase) * Math.PI * 0.5,
    };
  }

  renderPolonaise(dt) {
    const { width, height } = this.state;
    const settings = this.state.polonaise;
    const geometry = this.polonaiseGeometry();
    const { horizontal, size, margin, centers } = geometry;
    const travelLength = horizontal ? width : height;
    const spacing = size + margin;
    const beat = this.advancePolonaise(dt, settings);

    centers.forEach((center, lineIndex) => {
      let sign = settings.direction === "right" || settings.direction === "down" ? 1 : -1;
      if (settings.alternating && lineIndex % 2) sign *= -1;
      const completedOffset = sign * beat.step * size + settings.lineOffsets[lineIndex];
      const firstIndex = Math.floor((-size - completedOffset) / spacing) - 2;
      const lastIndex = Math.ceil((travelLength + size - completedOffset) / spacing) + 2;
      for (let index = firstIndex; index <= lastIndex; index += 1) {
        const start = index * spacing + completedOffset;
        const floor = center + size * 0.5;
        const position = this.tumbleStep(start, floor, size, horizontal, sign, beat.step, beat.phase);
        if (horizontal && (position.x < -size || position.x > width + size)) continue;
        if (!horizontal && (position.y < -size || position.y > height + size)) continue;
        const asset = this.pickLogo(index + lineIndex * 3, settings.logo);
        const alternatingRotation = ((index + lineIndex) & 1) * Math.PI * 0.5;
        this.drawLogo(asset, position.x, position.y, size, position.angle + alternatingRotation, this.state.foreground);
      }
    });
  }

  noiseAngle(x, y, time, density, seed) {
    const scale = 0.5 + density * 2.5;
    return (Math.sin(x * scale + time * 0.32 + seed) + Math.cos(y * scale * 1.3 - time * 0.27 + seed * 0.7)) * Math.PI;
  }

  partyCellPosition(col, row) {
    const grid = this.partyGrid;
    return { x: grid.originX + col * grid.spacingX, y: grid.originY + row * grid.spacingY };
  }

  choosePartyMove(item, occupied, reserved) {
    const directions = [{ dc: 1, dr: 0 }, { dc: -1, dr: 0 }, { dc: 0, dr: 1 }, { dc: 0, dr: -1 }];
    const noise = this.noiseAngle(item.col, item.row, this.time, this.state.party.noise, item.seed);
    directions.sort((a, b) => {
      const angleA = Math.atan2(a.dr, a.dc); const angleB = Math.atan2(b.dr, b.dc);
      const deltaA = Math.abs(Math.atan2(Math.sin(angleA - noise), Math.cos(angleA - noise)));
      const deltaB = Math.abs(Math.atan2(Math.sin(angleB - noise), Math.cos(angleB - noise)));
      return deltaA - deltaB;
    });
    const destination = directions.map(({ dc, dr }) => ({ col: item.col + dc, row: item.row + dr, dc, dr })).find((cell) => {
      if (cell.col < 0 || cell.row < 0 || cell.col >= this.partyGrid.cols || cell.row >= this.partyGrid.rows) return false;
      const key = `${cell.col},${cell.row}`;
      return !occupied.has(key) && !reserved.has(key);
    });
    if (!destination) { item.nextMoveAt = this.time + 0.25; return; }
    item.fromCol = item.col; item.fromRow = item.row;
    item.toCol = destination.col; item.toRow = destination.row;
    item.progress = 0;
    item.duration = 1.18 - this.state.party.speed * 0.82;
    item.startAngle = item.angle;
    const turn = destination.dc !== 0 ? destination.dc : -destination.dr;
    item.targetAngle = item.angle + turn * Math.PI * 0.5;
    reserved.add(`${destination.col},${destination.row}`);
  }

  renderParty(dt) {
    const settings = this.state.party;
    const occupied = new Set(this.party.map((item) => `${item.col},${item.row}`));
    const reserved = new Set(this.party.filter((item) => item.progress < 1).map((item) => `${item.toCol},${item.toRow}`));
    for (const item of this.party) {
      if (item.progress >= 1 && this.time >= item.nextMoveAt) this.choosePartyMove(item, occupied, reserved);
      if (item.progress < 1) {
        item.progress = Math.min(1, item.progress + dt / item.duration);
        if (item.progress >= 1) {
          item.col = item.toCol; item.row = item.toRow; item.angle = item.targetAngle;
          item.nextMoveAt = this.time + 0.08 + (1 - settings.noise) * 0.34;
          item.seed += 0.73;
        }
      }
      const start = this.partyCellPosition(item.fromCol, item.fromRow);
      const end = this.partyCellPosition(item.toCol, item.toRow);
      const phase = item.progress >= 1 ? 1 : (0.5 - Math.cos(item.progress * Math.PI) * 0.5);
      const x = start.x + (end.x - start.x) * phase;
      const y = start.y + (end.y - start.y) * phase;
      const angle = item.startAngle + (item.targetAngle - item.startAngle) * phase;
      this.drawLogo(item.logo, x, y, item.size, angle, this.state.foreground);
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
