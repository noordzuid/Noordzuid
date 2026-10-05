const LOGO_VARIANTS = [
  { id: 'vary', label: 'Variëren' },
  { id: 'text', label: 'Tekst' },
  { id: 'original', label: 'Standaard', path: 'assets/logo.svg' },
  { id: 'squares', label: 'Vierkanten', path: 'assets/logo-squares.svg' },
  { id: 'circles', label: 'Cirkels', path: 'assets/logo-circles.svg' },
  { id: 'long-circles', label: 'Lange cirkels', path: 'assets/logo-longcircles.svg' },
  { id: 'short-circles', label: 'Korte cirkels', path: 'assets/logo-shortcircles.svg' },
  { id: 'lines', label: 'Lijnen', path: 'assets/logo-lines.svg' }
];

const DRAWABLE_VARIANTS = LOGO_VARIANTS.filter(variant => variant.path);
const STROKE_PATHS = [
  'korterondjes.png',
  'langerondjes.png',
  'rectangle.png',
  'rondjes.png',
  'streepjes.png',
  'wave.png'
];
// Alle strokes krijgen deze breedte ten opzichte van Grootte; de hoogte volgt het assetformaat.
const STROKE_WIDTH_SCALE = 0.22;
const COLOR_PALETTE = [
  '#270C13', '#F28EFF', '#353214', '#FF8D8C', '#DDAAFF',
  '#8BCAFF', '#D4F2AA', '#053530', '#EBE8E4'
];

// Pas hier de tekst-hitbox per letter of cijfer aan. 1 = de automatisch gemeten grootte.
// width/height schalen de box; y verplaatst de letter binnen de box (+ = omlaag).
// Dit is extra ruimte per kant, als deel van de ingestelde Grootte (0.04 = 4%).
const TEXT_HITBOX_PADDING = 0.05;

const CHARACTER_HITBOX_SIZES = {
  a: { width: 0.9, height: 1.1 },
  b: { width: 0.9, height: 1 },
  c: { width: 0.9, height: 1 },
  d: { width: 0.9, height: 1 },
  e: { width: 0.9, height: 1 },
  f: { width: 1, height: 0.85, y: 0.08 },
  g: { width: 0.9, height: 1.0 },
  h: { width: 0.9, height: 0.85, y: 0.075 },
  i: { width: 0.8, height: 0.85, y: 0.075 },
  j: { width: 0.9, height: 1 },
  k: { width: 0.9, height: 0.85, y: 0.075 },
  l: { width: 0.9, height: 0.85, y: 0.075 },
  m: { width: 0.95, height: 0.8, y: 0.075 },
  n: { width: 0.9, height: 0.8, y: 0.075 },
  o: { width: 0.9, height: 0.9 },
  p: { width: 0.9, height: 0.95 },
  q: { width: 0.9, height: 0.95 },
  r: { width: 0.9, height: 0.8, y: 0.075 },
  s: { width: 0.9, height: 0.95 },
  t: { width: 1, height: 0.95 },
  u: { width: 0.9, height: 1 },
  v: { width: 1, height: 0.8, y: 0.075 },
  w: { width: 1, height: 0.8, y: 0.075 },
  x: { width: 1, height: 0.8, y: 0.075 },
  y: { width: 1, height: 1.0 },
  z: { width: 1, height: 0.8, y: 0.075 },
  '0': { width: 0.95, height: 0.93, y: 0 },
  '1': { width: 0.85, height: 0.8, y: 0.08 },
  '2': { width: 0.9, height: 0.8, y: 0.08 },
  '3': { width: 0.9, height: 0.95, y: 0 },
  '4': { width: 0.9, height: 0.8, y: 0.08 },
  '5': { width: 0.9, height: 0.9, y: 0 },
  '6': { width: 0.9, height: 0.9, y: 0 },
  '7': { width: 0.9, height: 0.8, y: 0.08 },
  '8': { width: 0.9, height: 0.93, y: 0 },
  '9': { width: 0.9, height: 0.93, y: 0 }
};
const DEFAULT_CHARACTER_HITBOX_SIZE = { width: 1, height: 1, y: 0 };
let state = {
  mode: 'confetti',
  size: 200,
  logoVariant: 'text',
  logoText: 'een',
  direction: 'left',
  polonaisePattern: 'continuous',
  polonaiseTracks: null,
  confettiForce: 2,
  randomStrokeColors: false,
  randomStrokePalette: [...COLOR_PALETTE],
  debugHitboxes: false,
  partyFrequency: 35,
  partyVariation: 0,
  partyDensity: 50,
  rollSpeed: 50,
  garlands: [],
  foreground: '#FF8D8C',
  background: '#270C13'
};

let exporting = false;
let exportingPNG = false;
let canvasElement;
let canvasContainer;
let canvasResizeObserver;
let logoImages = {};
let strokeImages = [];
let brandFont = 'Arial';
let logoCache = {};
let particles = [];
let particleSignature = '';
let lastPhysicsTime = 0;
let tileBodies = [];
let tileSignature = '';
let tileProgress = 0;
let tileStep = 0;
let lastTileTime = 0;
let lastDrawMode = '';
let drawingGarlandIndex = -1;
let rightMouseHeld = false;
let strokePointer = null;
let lastStrokeSpawn = 0;
const STROKE_SPAWN_INTERVAL = 90;

function preload() {
  DRAWABLE_VARIANTS.forEach(variant => {
    logoImages[variant.id] = loadImage(variant.path);
  });
  strokeImages = STROKE_PATHS.map(filename => loadImage(`assets/strokes/${filename}`));
}

function setup() {
  const initialWidth = constrain(Number(document.getElementById('canvas-width').value), 200, 6000);
  const initialHeight = constrain(Number(document.getElementById('canvas-height').value), 200, 6000);
  const canvas = createCanvas(initialWidth, initialHeight);
  canvas.parent('canvas-container');
  canvasElement = canvas.elt;
  canvasContainer = document.getElementById('canvas-container');
  canvasElement.addEventListener('contextmenu', event => event.preventDefault());
  canvasElement.addEventListener('pointermove', event => {
    strokePointer = canvasPoint(event);
    if (rightMouseHeld && !(event.buttons & 2)) stopStrokeSpawning();
  });
  canvasElement.addEventListener('pointerleave', () => {
    strokePointer = null;
  });
  window.addEventListener('pointerup', event => {
    if (event.button === 2) stopStrokeSpawning();
  });
  window.addEventListener('blur', stopStrokeSpawning);
  rectMode(CENTER);
  imageMode(CENTER);
  noStroke();

  loadBrandFont();

  connectControls();
  fitCanvasPreview();
  if (window.ResizeObserver) {
    canvasResizeObserver = new ResizeObserver(fitCanvasPreview);
    canvasResizeObserver.observe(canvasContainer);
  }

  syncControls();
  resetParticles(state);
  showStatus('Linksklik voor force · rechtermuisklik voor een stroke');
}

function loadBrandFont() {
  if (!window.FontFace || !document.fonts) return;
  const font = new FontFace('SaansLocal', 'url(assets/SaansSemiBold.woff2)');
  font.load().then(loadedFont => {
    document.fonts.add(loadedFont);
    brandFont = 'SaansLocal';
    particleSignature = '';
  }).catch(() => {
    brandFont = 'Arial';
  });
}

function draw() {
  const now = millis();
  const drawingState = state;
  const sceneTime = now / 1000;

  spawnHeldStroke(now);

  if (drawingState.mode !== lastDrawMode) {
    particleSignature = '';
    tileSignature = '';
    lastDrawMode = drawingState.mode;
  }

  background(drawingState.background);
  if (drawingState.mode === 'confetti') {
    drawConfetti(drawingState, now);
  } else if (drawingState.mode === 'polonaise') {
    drawStreamers(drawingState, sceneTime);
  } else if (drawingState.mode === 'streamers') {
    drawGarlands(drawingState);
  } else {
    drawParty(drawingState, now);
  }

}

function drawConfetti(source, now) {
  const signature = confettiSignature(source);
  if (signature !== particleSignature) resetParticles(source);

  const elapsed = constrain((now - lastPhysicsTime) / 1000, 0, 0.04);
  lastPhysicsTime = now;
  stepParticles(source, elapsed);

  particles.forEach((particle, index) => {
    if (particle.kind === 'stroke') {
      drawStrokeParticle(source, particle);
      return;
    }
    drawMark(
      source,
      particle.x,
      particle.y,
      particle.renderSize || source.size,
      particle.rotation,
      index,
      source.logoVariant === 'vary' ? variantAt(source, index) : particle.variant,
      particle.character
    );
  });

  if (source.debugHitboxes && !exporting && !exportingPNG) {
    drawConfettiHitboxes();
  }
}

function drawConfettiHitboxes() {
  push();
  rectMode(CENTER);
  noFill();
  stroke('#00E5FF');
  strokeWeight(max(1, min(width, height) / 700));
  particles.forEach(particle => {
    push();
    translate(particle.x, particle.y);
    rotate(radians(particle.rotation));
    rect(0, 0, particle.halfWidth * 2, particle.halfHeight * 2);
    pop();
  });
  pop();
}

function resetParticles(source) {
  const characters = textCharacters(source);
  if (source.logoVariant === 'text') {
    particles = createTextParticles(source, characters);
    particleSignature = confettiSignature(source);
    lastPhysicsTime = millis();
    return;
  }

  const halfSize = source.size * 0.52;
  const spacing = halfSize * 2 + max(4, source.size * 0.06);
  const columns = max(1, floor((width - halfSize * 2) / spacing) + 1);
  const rows = max(1, floor((height - halfSize * 2) / spacing) + 1);
  const amount = min(
    columns * rows,
    constrain(round(width * height / max(1, source.size * source.size) * 0.075), 12, 34)
  );
  const slots = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      slots.push({
        x: width / 2 + (col - (columns - 1) / 2) * spacing,
        y: height / 2 + (row - (rows - 1) / 2) * spacing,
        order: (sin((col + 1) * 12.9898 + (row + 1) * 78.233) + 1) / 2
      });
    }
  }
  slots.sort((a, b) => a.order - b.order);

  particles = slots.slice(0, amount).map((slot, index) => ({
    x: slot.x,
    y: slot.y,
    vx: 0,
    vy: 0,
    rotation: (index % 2) * 90,
    angularVelocity: 0,
    halfWidth: halfSize,
    halfHeight: halfSize,
    boundsSize: source.size,
    variant: variantAt(source, index),
    character: characters[index % characters.length]
  }));
  particleSignature = confettiSignature(source);
  lastPhysicsTime = millis();
}

function createTextParticles(source, characters, renderSize = source.size) {
  const renderSource = { ...source, size: renderSize };
  const gap = max(3, renderSize * 0.05);
  const margin = max(8, renderSize * 0.12);
  const rows = [];
  let currentRow = [];
  let currentWidth = 0;

  characters.forEach((character, index) => {
    const bounds = textParticleBounds(renderSource, character);
    const itemWidth = bounds.halfWidth * 2;
    if (currentRow.length && currentWidth + gap + itemWidth > width - margin * 2) {
      rows.push(currentRow);
      currentRow = [];
      currentWidth = 0;
    }
    currentRow.push({ character, index, ...bounds });
    currentWidth += (currentRow.length > 1 ? gap : 0) + itemWidth;
  });
  if (currentRow.length) rows.push(currentRow);

  const rowGap = max(5, renderSize * 0.08);
  const rowHeights = rows.map(row => max(...row.map(item => item.halfHeight * 2)));
  const totalHeight = rowHeights.reduce((total, value) => total + value, 0) +
    max(0, rows.length - 1) * rowGap;
  const availableHeight = max(20, height - margin * 2);
  if (totalHeight > availableHeight && renderSize > 8) {
    return createTextParticles(
      source,
      characters,
      max(8, renderSize * availableHeight / totalHeight * 0.96)
    );
  }
  let y = (height - totalHeight) / 2;
  const result = [];

  rows.forEach((row, rowIndex) => {
    const rowWidth = row.reduce((total, item) => total + item.halfWidth * 2, 0) +
      max(0, row.length - 1) * gap;
    let x = (width - rowWidth) / 2;
    const rowHeight = rowHeights[rowIndex];
    row.forEach(item => {
      result.push({
        kind: 'text',
        x: x + item.halfWidth,
        y: y + rowHeight / 2,
        vx: 0,
        vy: 0,
        rotation: 0,
        angularVelocity: 0,
        halfWidth: item.halfWidth,
        halfHeight: item.halfHeight,
        boundsSize: source.size,
        renderSize,
        variant: 'text',
        character: item.character
      });
      x += item.halfWidth * 2 + gap;
    });
    y += rowHeight + rowGap;
  });
  return result;
}

function textParticleBounds(source, character) {
  const glyph = textGlyphMetrics(source.size, character);
  const padding = max(0, source.size * TEXT_HITBOX_PADDING);
  const hitboxSize = CHARACTER_HITBOX_SIZES[character.toLocaleUpperCase('nl-NL')] ||
    DEFAULT_CHARACTER_HITBOX_SIZE;
  return {
    halfWidth: max(2, (glyph.width / 2 + padding) * hitboxSize.width),
    halfHeight: max(3, (glyph.height / 2 + padding) * hitboxSize.height)
  };
}

function textGlyphMetrics(size, character) {
  push();
  textFont(brandFont);
  textStyle(BOLD);
  textSize(size * 1.5);
  textAlign(LEFT, BASELINE);
  const metrics = drawingContext.measureText(character);
  pop();
  const left = Number.isFinite(metrics.actualBoundingBoxLeft)
    ? metrics.actualBoundingBoxLeft
    : 0;
  const right = Number.isFinite(metrics.actualBoundingBoxRight)
    ? metrics.actualBoundingBoxRight
    : metrics.width;
  const ascent = metrics.actualBoundingBoxAscent || size * 0.72;
  const descent = metrics.actualBoundingBoxDescent || size * 0.18;
  return {
    width: max(1, left + right),
    height: max(1, ascent + descent),
    drawX: (left - right) / 2,
    drawY: (ascent - descent) / 2
  };
}

function confettiSignature(source) {
  return [width, height, source.logoVariant, source.logoText].join('|');
}

function stepParticles(source, elapsed) {
  if (!elapsed) return;
  const steps = 5;
  const dt = elapsed / steps;

  for (let step = 0; step < steps; step++) {
    particles.forEach(particle => {
      updateParticleBounds(particle, source);
      particle.vy += 720 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rotation += particle.angularVelocity * dt;
      particle.vx *= pow(0.72, dt);
      particle.angularVelocity *= pow(0.22, dt);

      const extent = rotatedParticleExtents(particle);
      if (particle.x < extent.x) {
        particle.x = extent.x;
        particle.vx = abs(particle.vx) * 0.45;
      } else if (particle.x > width - extent.x) {
        particle.x = width - extent.x;
        particle.vx = -abs(particle.vx) * 0.45;
      }

      if (particle.y < extent.y) {
        particle.y = extent.y;
        particle.vy = abs(particle.vy) * 0.45;
      } else if (particle.y > height - extent.y) {
        particle.y = height - extent.y;
        particle.vy = -abs(particle.vy) * 0.28;
        particle.vx *= 0.9;
        const rollingSpeed = degrees(particle.vx / max(1, extent.y));
        particle.angularVelocity = lerp(particle.angularVelocity, rollingSpeed, 0.18);
        if (abs(particle.vy) < 18) particle.vy = 0;
        if (abs(particle.vx) < 16) particle.vx = 0;
        if (abs(particle.angularVelocity) < 8) particle.angularVelocity = 0;
      }
      particle.angularVelocity = constrain(particle.angularVelocity, -120, 120);
    });
    for (let iteration = 0; iteration < 3; iteration++) {
      resolveParticleCollisions();
    }
    particles.forEach(particle => {
      const extent = rotatedParticleExtents(particle);
      particle.x = constrain(particle.x, extent.x, width - extent.x);
      particle.y = constrain(particle.y, extent.y, height - extent.y);
    });
  }
}

function updateParticleBounds(particle, source) {
  if (particle.kind === 'stroke' || particle.boundsSize === source.size) return;
  if (particle.kind === 'text' || particle.variant === 'text') {
    const bounds = textParticleBounds(
      { ...source, size: particle.renderSize || source.size },
      particle.character || ''
    );
    particle.halfWidth = bounds.halfWidth;
    particle.halfHeight = bounds.halfHeight;
  } else {
    particle.halfWidth = source.size * 0.52;
    particle.halfHeight = source.size * 0.52;
  }
  particle.boundsSize = source.size;
}

function rotatedParticleExtents(particle) {
  const angle = radians(particle.rotation);
  return {
    x: abs(cos(angle)) * particle.halfWidth + abs(sin(angle)) * particle.halfHeight,
    y: abs(sin(angle)) * particle.halfWidth + abs(cos(angle)) * particle.halfHeight
  };
}

function particleAxes(particle) {
  const angle = radians(particle.rotation);
  const cosine = cos(angle);
  const sine = sin(angle);
  return [
    { x: cosine, y: sine },
    { x: -sine, y: cosine }
  ];
}

function projectionRadius(particle, particleAxis, crossAxis, testAxis) {
  return particle.halfWidth * abs(particleAxis.x * testAxis.x + particleAxis.y * testAxis.y) +
    particle.halfHeight * abs(crossAxis.x * testAxis.x + crossAxis.y * testAxis.y);
}

function orientedRectCollision(first, second) {
  const firstAxes = particleAxes(first);
  const secondAxes = particleAxes(second);
  const axes = [...firstAxes, ...secondAxes];
  const centerDifference = {
    x: second.x - first.x,
    y: second.y - first.y
  };
  let minimumOverlap = Infinity;
  let collisionNormal = null;

  for (const axis of axes) {
    const centerDistance = centerDifference.x * axis.x + centerDifference.y * axis.y;
    const firstRadius = projectionRadius(first, firstAxes[0], firstAxes[1], axis);
    const secondRadius = projectionRadius(second, secondAxes[0], secondAxes[1], axis);
    const overlap = firstRadius + secondRadius - abs(centerDistance);
    if (overlap <= 0) return null;
    if (overlap < minimumOverlap) {
      minimumOverlap = overlap;
      const direction = centerDistance < 0 ? -1 : 1;
      collisionNormal = { x: axis.x * direction, y: axis.y * direction };
    }
  }

  return { overlap: minimumOverlap, normal: collisionNormal };
}

function resolveParticleCollisions() {
  for (let firstIndex = 0; firstIndex < particles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < particles.length; secondIndex++) {
      const first = particles[firstIndex];
      const second = particles[secondIndex];
      const collision = orientedRectCollision(first, second);
      if (!collision) continue;

      const nx = collision.normal.x;
      const ny = collision.normal.y;
      const overlap = collision.overlap;
      first.x -= nx * overlap * 0.5;
      first.y -= ny * overlap * 0.5;
      second.x += nx * overlap * 0.5;
      second.y += ny * overlap * 0.5;

      const relativeSpeed = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      if (relativeSpeed >= 0) continue;
      const impulse = -relativeSpeed * 0.52;
      first.vx -= nx * impulse;
      first.vy -= ny * impulse;
      second.vx += nx * impulse;
      second.vy += ny * impulse;

      const tangentX = -ny;
      const tangentY = nx;
      const relativeTangent = (second.vx - first.vx) * tangentX +
        (second.vy - first.vy) * tangentY;
      const frictionImpulse = constrain(-relativeTangent * 0.16, -abs(impulse) * 0.45, abs(impulse) * 0.45);
      first.vx -= tangentX * frictionImpulse;
      first.vy -= tangentY * frictionImpulse;
      second.vx += tangentX * frictionImpulse;
      second.vy += tangentY * frictionImpulse;
    }
  }
}

function pushConfetti(x, y) {
  if (particleSignature !== confettiSignature(state)) resetParticles(state);
  const reach = max(width, height) * 0.72;
  particles.forEach((particle, index) => {
    let dx = particle.x - x;
    let dy = particle.y - y;
    let distanceFromClick = sqrt(dx * dx + dy * dy);
    if (distanceFromClick < 1) {
      const angle = index * 2.399963;
      dx = cos(angle);
      dy = sin(angle);
      distanceFromClick = 1;
    }
    const force = 1000 * state.confettiForce *
      pow(max(0.14, 1 - distanceFromClick / reach), 1.5);
    particle.vx += dx / distanceFromClick * force;
    particle.vy += dy / distanceFromClick * force - 160 * state.confettiForce;
    particle.angularVelocity = constrain(
      particle.angularVelocity + sin((index + 1) * 1.9) * 35,
      -90,
      90
    );
  });
  showStatus('Confetti!');
}

function spawnStroke(x, y) {
  if (particleSignature !== confettiSignature(state)) resetParticles(state);
  if (!strokeImages.length) return;
  const strokeIndex = floor(random(strokeImages.length));
  const imageSource = strokeImages[strokeIndex];
  const strokeAspect = imageSource.height / max(1, imageSource.width);
  const tallestStrokeAspect = strokeImages.reduce((largest, imageSource) => (
    max(largest, imageSource.height / max(1, imageSource.width))
  ), 1);
  const requestedWidth = state.size * STROKE_WIDTH_SCALE;
  const maxHeight = min(width, height) * 0.72;
  const renderWidth = min(requestedWidth, maxHeight / tallestStrokeAspect);
  const renderHeight = renderWidth * strokeAspect;
  const rotation = floor(random(4)) * 90;
  const particle = {
    kind: 'stroke',
    strokeIndex,
    color: state.randomStrokeColors
      ? randomStrokeColor(state)
      : null,
    renderWidth,
    renderHeight,
    x,
    y,
    vx: random(-140, 140),
    vy: random(-280, -130),
    rotation,
    angularVelocity: random(-55, 55),
    halfWidth: renderWidth * 0.52,
    halfHeight: renderHeight * 0.5,
    boundsSize: state.size
  };
  const extent = rotatedParticleExtents(particle);
  particle.x = constrain(particle.x, extent.x, width - extent.x);
  particle.y = constrain(particle.y, extent.y, height - extent.y);
  particles.push(particle);
  showStatus('Stroke toegevoegd');
}

function drawStrokeParticle(source, particle) {
  const palette = activeStrokePalette(source);
  if (source.randomStrokeColors && (!particle.color || !palette.includes(particle.color))) {
    particle.color = randomStrokeColor(source);
  }
  const strokeColor = source.randomStrokeColors ? particle.color : source.foreground;
  const stroke = renderedStroke(particle.strokeIndex, strokeColor);
  push();
  translate(particle.x, particle.y);
  rotate(radians(particle.rotation));
  image(stroke, 0, 0, particle.renderWidth, particle.renderHeight);
  pop();
}

function activeStrokePalette(source = state) {
  const selected = Array.isArray(source.randomStrokePalette)
    ? source.randomStrokePalette
    : COLOR_PALETTE;
  const palette = COLOR_PALETTE.filter(colorValue => selected.includes(colorValue));
  return palette.length ? palette : COLOR_PALETTE;
}

function randomStrokeColor(source = state) {
  const palette = activeStrokePalette(source);
  return palette[floor(random(palette.length))];
}

function renderedStroke(index, foreground) {
  const cacheKey = `stroke-${index}-${foreground}-${pixelDensity()}`;
  if (logoCache[cacheKey]) return logoCache[cacheKey];
  const source = strokeImages[index];
  const buffer = createGraphics(source.width, source.height);
  buffer.clear();
  buffer.image(source, 0, 0, source.width, source.height);
  buffer.drawingContext.globalCompositeOperation = 'source-in';
  buffer.noStroke();
  buffer.fill(foreground);
  buffer.rectMode(CORNER);
  buffer.rect(0, 0, source.width, source.height);
  buffer.drawingContext.globalCompositeOperation = 'source-over';
  logoCache[cacheKey] = buffer;
  return buffer;
}

function drawStreamers(source, sceneTime) {
  const horizontal = source.direction === 'left' || source.direction === 'right';
  const directionSign = source.direction === 'left' || source.direction === 'up' ? -1 : 1;
  const pitch = contentPitch(source);
  const alongLength = horizontal ? width : height;
  const crossLength = horizontal ? height : width;
  const alongOrigin = centredGridOrigin(alongLength, pitch);
  const cells = floor(alongLength / pitch) + 4;
  const crossCells = max(1, floor(crossLength / pitch));
  const crossOrigin = centredGridOrigin(crossLength, pitch);
  const tracks = activePolonaiseTracks(source, crossCells);
  const rolls = sceneTime * rollRate(source);
  const completedRolls = floor(rolls);
  const progress = rolls - completedRolls;
  const rollProgress = boxRollProgress(progress, source);
  tracks.forEach(strand => {
    const cross = crossOrigin + (strand + 0.5) * pitch;
    for (let cell = -2; cell < cells; cell++) {
      const along = alongOrigin + (cell + 0.5) * pitch;
      const x = horizontal ? along : cross;
      const y = horizontal ? cross : along;
      const logicalIndex = cell - directionSign * completedRolls + strand * cells;
      if (!polonaiseCellVisible(source, logicalIndex, strand)) continue;
      const initialRotation = positiveModulo(logicalIndex, 2) * 90;
      const baseRotation = initialRotation + directionSign * completedRolls * 90;
      const pose = rollingPose(x, y, pitch, source.direction, rollProgress);
      const rotation = baseRotation + directionSign * rollProgress * 90;
      drawMark(
        source,
        pose.x,
        pose.y,
        source.size,
        rotation,
        logicalIndex,
        variantAt(source, logicalIndex)
      );
    }
  });
}

function activePolonaiseTracks(source, amount) {
  if (Array.isArray(source.polonaiseTracks)) {
    return source.polonaiseTracks.filter(index => index >= 0 && index < amount);
  }
  return Array.from({ length: amount }, (_, index) => index)
    .filter(index => index % 2 === 0);
}

function polonaiseCellVisible(source, logicalIndex, strand) {
  if (source.polonaisePattern === 'alternating') {
    return positiveModulo(logicalIndex + strand, 2) === 0;
  }
  if (source.polonaisePattern === 'blocks') {
    return positiveModulo(logicalIndex, 4) < 2;
  }
  return true;
}

function drawGarlands(source) {
  const garlands = source.garlands || [];
  const threadColor = color(source.foreground);
  threadColor.setAlpha(115);

  garlands.forEach(points => {
    if (!points.length) return;
    const hangingPoints = hangingGarlandPoints(points, source);
    push();
    noFill();
    stroke(threadColor);
    strokeWeight(max(2, source.size * 0.035));
    beginShape();
    hangingPoints.forEach(point => vertex(point.x, point.y));
    endShape();
    pop();
    drawGarlandMarks(source, hangingPoints);
  });
}

function hangingGarlandPoints(points, source) {
  if (points.length < 2) return points;
  const from = points[0];
  const to = points[points.length - 1];
  const distanceBetweenPins = dist(from.x, from.y, to.x, to.y);
  const sag = min(height * 0.32, max(source.size * 1.15, distanceBetweenPins * 0.2));
  const control = {
    x: (from.x + to.x) / 2,
    y: max(from.y, to.y) + sag
  };
  return Array.from({ length: 33 }, (_, index) => {
    const t = index / 32;
    const inverse = 1 - t;
    return {
      x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y
    };
  });
}

function drawGarlandMarks(source, points) {
  if (!points.length) return;
  const spacing = contentPitch(source);
  let distanceToNext = 0;
  let markIndex = 0;

  if (points.length === 1) {
    drawMark(source, points[0].x, points[0].y, source.size, 0, 0);
    return;
  }

  for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex++) {
    const from = points[segmentIndex - 1];
    const to = points[segmentIndex];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segmentLength = sqrt(dx * dx + dy * dy);
    if (segmentLength < 0.001) continue;

    while (distanceToNext <= segmentLength) {
      const progress = distanceToNext / segmentLength;
      drawMark(
        source,
        lerp(from.x, to.x, progress),
        lerp(from.y, to.y, progress),
        source.size,
        (markIndex % 2) * 90,
        markIndex
      );
      markIndex++;
      distanceToNext += spacing;
    }
    distanceToNext -= segmentLength;
  }
}

function drawParty(source, now) {
  const signature = partySignature(source);
  if (signature !== tileSignature) resetTiles(source);

  const elapsed = constrain((now - lastTileTime) / 1000, 0, 0.05);
  lastTileTime = now;
  tileProgress += elapsed / partyStepDuration(source);
  while (tileProgress >= 1) {
    tileBodies.forEach(tile => {
      tile.col = tile.targetCol;
      tile.row = tile.targetRow;
      tile.rotation = tile.targetRotation;
    });
    tileProgress -= 1;
    tileStep++;
    planTileRolls(source);
  }

  tileBodies.forEach((tile, index) => {
    const layout = contentGrid(source);
    const startX = layout.left + (tile.col + 0.5) * layout.pitch;
    const startY = layout.top + (tile.row + 0.5) * layout.pitch;
    const delay = tile.delay || 0;
    const individualProgress = tile.direction === 'none'
      ? 0
      : constrain((tileProgress - delay) / max(0.01, 1 - delay), 0, 1);
    const rollProgress = boxRollProgress(individualProgress, source);
    const pose = rollingPose(startX, startY, layout.pitch, tile.direction, rollProgress);
    const rotation = lerp(tile.rotation, tile.targetRotation, rollProgress);
    drawMark(
      source,
      pose.x,
      pose.y,
      source.size,
      rotation,
      index,
      source.logoVariant === 'vary' ? variantAt(source, index) : tile.variant,
      tile.character
    );
  });
}

function resetTiles(source) {
  const layout = contentGrid(source);
  const columns = layout.columns;
  const rows = layout.rows;
  const characters = textCharacters(source);
  tileBodies = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const density = constrain(Number(source.partyDensity ?? 50), 0, 100) / 100;
      const threshold = lerp(0.92, 0.18, density);
      if (noise(col * 0.2 + 20, row * 0.2 + 40) < threshold) continue;
      const index = tileBodies.length;
      tileBodies.push({
        col,
        row,
        targetCol: col,
        targetRow: row,
        direction: 'none',
        delay: 0,
        rotation: (index % 2) * 90,
        targetRotation: (index % 2) * 90,
        variant: variantAt(source, index),
        character: characters[index % characters.length]
      });
    }
  }

  tileSignature = partySignature(source);
  tileProgress = 0;
  tileStep = 0;
  lastTileTime = millis();
  planTileRolls(source);
}

function partySignature(source) {
  return [
    width,
    height,
    round(source.size),
    source.logoVariant,
    source.logoText,
    round(Number(source.partyDensity ?? 50))
  ].join('|');
}

function partyStepDuration(source) {
  return 1 / rollRate(source);
}

function rollRate(source) {
  const speed = constrain(
    Number(source.rollSpeed ?? source.partyMotion ?? source.varySpeed ?? 50),
    0,
    100
  ) / 100;
  return lerp(0.3, 2.5, speed);
}

function planTileRolls(source) {
  const layout = contentGrid(source);
  const columns = layout.columns;
  const rows = layout.rows;
  const occupied = new Set(tileBodies.map(tile => `${tile.col},${tile.row}`));
  const directionNames = ['right', 'down', 'left', 'up'];

  const plannedBodies = [...tileBodies].sort((first, second) => {
    const firstNoise = noise(first.col * 0.17, first.row * 0.17, tileStep * 0.11);
    const secondNoise = noise(second.col * 0.17, second.row * 0.17, tileStep * 0.11);
    return secondNoise - firstNoise;
  });

  plannedBodies.forEach((tile, orderIndex) => {
    const frequency = constrain(Number(source.partyFrequency ?? 35), 0, 100) / 100;
    const activity = noise(
      tile.col * 0.37 + 70,
      tile.row * 0.37 + 90,
      tileStep * 0.19
    );
    if (activity > frequency) {
      tile.targetCol = tile.col;
      tile.targetRow = tile.row;
      tile.direction = 'none';
      tile.delay = 0;
      tile.targetRotation = tile.rotation;
      return;
    }
    const startDirection = floor(
      noise(tile.col * 0.23 + 10, tile.row * 0.23 + 30, tileStep * 0.13) * 4
    ) % 4;
    let selectedDirection = 'none';
    let targetCol = tile.col;
    let targetRow = tile.row;

    for (let offset = 0; offset < 4; offset++) {
      const direction = directionNames[(startDirection + offset) % 4];
      const delta = directionDelta(direction);
      const nextCol = tile.col + delta.col;
      const nextRow = tile.row + delta.row;
      const key = `${nextCol},${nextRow}`;
      if (
        nextCol < 0 || nextCol >= columns || nextRow < 0 || nextRow >= rows ||
        occupied.has(key)
      ) continue;
      selectedDirection = direction;
      targetCol = nextCol;
      targetRow = nextRow;
      break;
    }

    const currentKey = `${tile.col},${tile.row}`;
    const targetKey = `${targetCol},${targetRow}`;
    if (selectedDirection !== 'none') {
      occupied.delete(currentKey);
      occupied.add(targetKey);
    }
    const turn = selectedDirection === 'left' || selectedDirection === 'up' ? -90 :
      selectedDirection === 'none' ? 0 : 90;
    tile.targetCol = targetCol;
    tile.targetRow = targetRow;
    tile.direction = selectedDirection;
    const variation = constrain(Number(source.partyVariation ?? 50), 0, 100) / 100;
    tile.delay = selectedDirection === 'none'
      ? 0
      : noise(tile.col * 0.51 + 130, tile.row * 0.51 + 150, tileStep * 0.23) *
        lerp(0, 0.72, variation);
    tile.targetRotation = tile.rotation + turn;
    tile.planOrder = orderIndex;
  });
}

function contentPitch(source) {
  return source.size * 1.38;
}

function centredGridOrigin(length, pitch) {
  const cells = max(1, floor(length / pitch));
  return (length - cells * pitch) / 2;
}

function contentGrid(source) {
  const pitch = contentPitch(source);
  const columns = max(1, floor(width / pitch));
  const rows = max(1, floor(height / pitch));
  return {
    pitch,
    columns,
    rows,
    left: (width - columns * pitch) / 2,
    top: (height - rows * pitch) / 2
  };
}

function rollingPose(x, y, size, direction, progress) {
  if (direction === 'none' || progress <= 0) return { x, y };
  const half = size / 2;
  const angle = radians(progress * 90) *
    (direction === 'left' || direction === 'up' ? -1 : 1);
  let pivotX = x;
  let pivotY = y;

  if (direction === 'right') {
    pivotX += half;
    pivotY += half;
  } else if (direction === 'left') {
    pivotX -= half;
    pivotY += half;
  } else if (direction === 'down') {
    pivotX -= half;
    pivotY += half;
  } else if (direction === 'up') {
    pivotX -= half;
    pivotY -= half;
  }

  const offsetX = x - pivotX;
  const offsetY = y - pivotY;
  return {
    x: pivotX + offsetX * cos(angle) - offsetY * sin(angle),
    y: pivotY + offsetX * sin(angle) + offsetY * cos(angle)
  };
}

function boxRollProgress(progress, source) {
  const t = constrain(progress, 0, 1);
  const speed = constrain(
    Number(source.rollSpeed ?? source.partyMotion ?? source.varySpeed ?? 50),
    0,
    100
  ) / 100;
  const accelerationShare = lerp(0.82, 0.12, sqrt(speed));
  return lerp(t, t * t, accelerationShare);
}

function directionDelta(direction) {
  return {
    left: { col: -1, row: 0 },
    right: { col: 1, row: 0 },
    up: { col: 0, row: -1 },
    down: { col: 0, row: 1 },
    none: { col: 0, row: 0 }
  }[direction];
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function drawMark(source, x, y, size, rotation, index, variantOverride, characterOverride) {
  const variant = variantOverride || variantAt(source, index);
  push();
  translate(x, y);
  rotate(radians(rotation));
  if (variant === 'text') {
    const character = characterOverride ?? textCharacterAt(source, index);
    const glyph = textGlyphMetrics(size, character);
    const hitboxSize = CHARACTER_HITBOX_SIZES[character.toLocaleUpperCase('nl-NL')] ||
      DEFAULT_CHARACTER_HITBOX_SIZE;
    fill(source.foreground);
    textAlign(LEFT, BASELINE);
    textFont(brandFont);
    textStyle(BOLD);
    textSize(size * 1.50);
    text(character, glyph.drawX, glyph.drawY + size * (hitboxSize.y || 0));
  } else {
    const logo = renderedLogo(variant, source.foreground);
    image(logo, 0, 0, size, size);
  }
  pop();
}

function renderedLogo(variantId, foreground) {
  const safeVariant = logoImages[variantId] ? variantId : 'original';
  const cacheKey = `${safeVariant}-${foreground}-${pixelDensity()}`;
  if (logoCache[cacheKey]) return logoCache[cacheKey];

  const source = logoImages[safeVariant];
  const bufferSize = 384;
  const buffer = createGraphics(bufferSize, bufferSize);
  buffer.clear();
  buffer.imageMode(CENTER);
  buffer.image(source, bufferSize / 2, bufferSize / 2, bufferSize, bufferSize);
  buffer.drawingContext.globalCompositeOperation = 'source-in';
  buffer.noStroke();
  buffer.fill(foreground);
  buffer.rectMode(CORNER);
  buffer.rect(0, 0, bufferSize, bufferSize);
  buffer.drawingContext.globalCompositeOperation = 'source-over';
  logoCache[cacheKey] = buffer;
  return buffer;
}

function clearLogoCache() {
  Object.values(logoCache).forEach(buffer => buffer.remove());
  logoCache = {};
}

function variantAt(source, index) {
  if (source.logoVariant === 'text') return 'text';
  if (source.logoVariant !== 'vary') return source.logoVariant || 'original';
  const variantIndex = positiveModulo(
    index * 5 + floor(index / 3),
    DRAWABLE_VARIANTS.length
  );
  return DRAWABLE_VARIANTS[variantIndex].id;
}

function textCharacters(source) {
  const characters = Array.from(source.logoText || 'NOORDZUID');
  return characters.length ? characters : [''];
}

function textCharacterAt(source, index) {
  const characters = textCharacters(source);
  return characters[positiveModulo(index, characters.length)];
}

function mousePressed(event) {
  if (event.target !== canvasElement) return;
  const point = canvasPoint(event);
  if (state.mode === 'confetti') {
    if (event.button === 2) {
      rightMouseHeld = true;
      strokePointer = point;
      lastStrokeSpawn = millis();
      spawnStroke(point.x, point.y);
    } else {
      pushConfetti(point.x, point.y);
    }
    return false;
  }
  if (state.mode === 'polonaise') {
    togglePolonaiseTrack(point);
    return false;
  }
  if (state.mode === 'streamers') {
    if (!Array.isArray(state.garlands)) state.garlands = [];
    if (drawingGarlandIndex < 0) {
      state.garlands.push([point]);
      drawingGarlandIndex = state.garlands.length - 1;
      showStatus('Kies nu het tweede ophangpunt');
    } else {
      state.garlands[drawingGarlandIndex].push(point);
      drawingGarlandIndex = -1;
      showStatus('Slinger opgehangen');
    }
    return false;
  }
}

function spawnHeldStroke(now) {
  if (!rightMouseHeld || !strokePointer || state.mode !== 'confetti') return;
  if (now - lastStrokeSpawn < STROKE_SPAWN_INTERVAL) return;
  spawnStroke(strokePointer.x, strokePointer.y);
  lastStrokeSpawn = now;
}

function stopStrokeSpawning() {
  rightMouseHeld = false;
  strokePointer = null;
}

function togglePolonaiseTrack(point) {
  const horizontal = state.direction === 'left' || state.direction === 'right';
  const crossLength = horizontal ? height : width;
  const crossCoordinate = horizontal ? point.y : point.x;
  const pitch = contentPitch(state);
  const amount = max(1, floor(crossLength / pitch));
  const origin = centredGridOrigin(crossLength, pitch);
  const track = constrain(floor((crossCoordinate - origin) / pitch), 0, amount - 1);
  const tracks = activePolonaiseTracks(state, amount);
  const existingIndex = tracks.indexOf(track);
  if (existingIndex >= 0) tracks.splice(existingIndex, 1);
  else tracks.push(track);
  state.polonaiseTracks = tracks.sort((a, b) => a - b);
  showStatus(existingIndex >= 0 ? 'Rij verwijderd' : 'Rij toegevoegd');
}

function canvasPoint(event) {
  const bounds = canvasElement.getBoundingClientRect();
  return {
    x: constrain((event.clientX - bounds.left) * width / bounds.width, 0, width),
    y: constrain((event.clientY - bounds.top) * height / bounds.height, 0, height)
  };
}

function connectControls() {
  const variantControl = document.getElementById('logo-variant');
  LOGO_VARIANTS.forEach(variant => {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variant.label;
    variantControl.appendChild(option);
  });

  document.getElementById('mode').addEventListener('change', event => {
    if (drawingGarlandIndex >= 0) {
      state.garlands.splice(drawingGarlandIndex, 1);
      drawingGarlandIndex = -1;
    }
    state.mode = event.target.value;
    particleSignature = '';
    updateModeControls();
    syncForegroundColors();
    showModeStatus();
  });
  document.getElementById('size').addEventListener('input', event => {
    state.size = Number(event.target.value);
    document.getElementById('size-value').value = `${state.size} px`;
    particleSignature = '';
  });
  document.getElementById('confetti-force').addEventListener('input', event => {
    state.confettiForce = Number(event.target.value);
    document.getElementById('confetti-force-value').value =
      `${round(state.confettiForce * 100)}%`;
  });
  document.getElementById('random-stroke-colors').addEventListener('change', event => {
    state.randomStrokeColors = event.target.checked;
    syncForegroundColors();
  });
  document.getElementById('debug-hitboxes').addEventListener('change', event => {
    state.debugHitboxes = event.target.checked;
  });
  document.getElementById('party-motion').addEventListener('input', event => {
    state.rollSpeed = Number(event.target.value);
    document.getElementById('party-motion-value').value = `${state.rollSpeed}%`;
    document.getElementById('vary-speed').value = state.rollSpeed;
    document.getElementById('vary-speed-value').value = `${state.rollSpeed}%`;
  });
  document.getElementById('party-frequency').addEventListener('input', event => {
    state.partyFrequency = Number(event.target.value);
    document.getElementById('party-frequency-value').value = `${state.partyFrequency}%`;
  });
  document.getElementById('party-variation').addEventListener('input', event => {
    state.partyVariation = Number(event.target.value);
    document.getElementById('party-variation-value').value = `${state.partyVariation}%`;
  });
  document.getElementById('party-density').addEventListener('input', event => {
    state.partyDensity = Number(event.target.value);
    document.getElementById('party-density-value').value = `${state.partyDensity}%`;
    tileSignature = '';
  });
  variantControl.addEventListener('change', event => {
    state.logoVariant = event.target.value;
    particleSignature = '';
    updateModeControls();
  });
  document.getElementById('vary-speed').addEventListener('input', event => {
    state.rollSpeed = Number(event.target.value);
    document.getElementById('vary-speed-value').value = `${state.rollSpeed}%`;
    document.getElementById('party-motion').value = state.rollSpeed;
    document.getElementById('party-motion-value').value = `${state.rollSpeed}%`;
  });
  document.getElementById('logo-text').addEventListener('input', event => {
    state.logoText = event.target.value;
    particleSignature = '';
  });
  document.getElementById('direction').querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      state.direction = button.dataset.value;
      state.polonaiseTracks = null;
      syncDirectionButtons();
    });
  });
  document.getElementById('polonaise-pattern').querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      state.polonaisePattern = button.dataset.value;
      syncPolonaisePatternButtons();
    });
  });
  document.getElementById('clear-streamers').addEventListener('click', () => {
    state.garlands = [];
    drawingGarlandIndex = -1;
    showStatus('Slingers gewist');
  });

  connectColors('foreground-colors', 'foreground');
  connectColors('background-colors', 'background');
  document.getElementById('canvas-width').addEventListener('change', resizeFromInputs);
  document.getElementById('canvas-height').addEventListener('change', resizeFromInputs);
  document.getElementById('export-png').addEventListener('click', exportPNG);
  document.getElementById('export-mp4').addEventListener('click', exportMP4);
}

function connectColors(containerId, property) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.swatch').forEach(button => {
    button.addEventListener('click', () => {
      if (property === 'foreground' && state.mode === 'confetti' && state.randomStrokeColors) {
        toggleRandomStrokeColor(button.dataset.color);
        return;
      }
      state[property] = button.dataset.color;
      setActiveColor(container, state[property]);
    });
  });
}

function toggleRandomStrokeColor(colorValue) {
  const selected = activeStrokePalette(state);
  const isSelected = selected.includes(colorValue);
  if (isSelected && selected.length === 1) {
    showStatus('Minimaal één random kleur moet aan blijven');
    return;
  }
  state.randomStrokePalette = isSelected
    ? selected.filter(value => value !== colorValue)
    : COLOR_PALETTE.filter(value => selected.includes(value) || value === colorValue);
  syncForegroundColors();
}

function syncForegroundColors() {
  const container = document.getElementById('foreground-colors');
  const randomFilter = state.mode === 'confetti' && state.randomStrokeColors;
  const palette = activeStrokePalette(state);
  container.classList.toggle('random-filter', randomFilter);
  document.getElementById('foreground-label').textContent = randomFilter ? 'Kleuren' : 'Voorgrond';
  container.querySelectorAll('.swatch').forEach(button => {
    const selected = randomFilter
      ? palette.includes(button.dataset.color)
      : button.dataset.color === state.foreground;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function setActiveColor(container, value) {
  container.querySelectorAll('.swatch').forEach(button => {
    button.classList.toggle('active', button.dataset.color === value);
  });
}

function updateModeControls() {
  document.getElementById('confetti-controls').hidden = state.mode !== 'confetti';
  document.getElementById('polonaise-controls').hidden = state.mode !== 'polonaise';
  document.getElementById('streamer-controls').hidden = state.mode !== 'streamers';
  document.getElementById('party-controls').hidden = state.mode !== 'party';
  document.getElementById('vary-controls').hidden = state.logoVariant !== 'vary';
  document.getElementById('text-controls').hidden = state.logoVariant !== 'text';
}

function syncDirectionButtons() {
  document.getElementById('direction').querySelectorAll('button').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.value === state.direction));
  });
}

function syncPolonaisePatternButtons() {
  document.getElementById('polonaise-pattern').querySelectorAll('button').forEach(button => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.value === (state.polonaisePattern || 'continuous'))
    );
  });
}

function showModeStatus() {
  const messages = {
    confetti: 'Linksklik voor force · rechtermuisklik voor een stroke',
    polonaise: 'De polonaise rolt continu in de gekozen richting',
    streamers: 'Klik een beginpunt en daarna een eindpunt',
    party: 'Het noisepatroon vervormt door rollende logo’s'
  };
  showStatus(messages[state.mode]);
}

function syncControls() {
  document.getElementById('mode').value = state.mode;
  document.getElementById('size').value = state.size;
  document.getElementById('size-value').value = `${round(state.size)} px`;
  document.getElementById('logo-variant').value = state.logoVariant;
  document.getElementById('logo-text').value = state.logoText;
  document.getElementById('confetti-force').value = state.confettiForce || 1;
  document.getElementById('confetti-force-value').value =
    `${round((state.confettiForce || 1) * 100)}%`;
  document.getElementById('random-stroke-colors').checked = Boolean(state.randomStrokeColors);
  document.getElementById('debug-hitboxes').checked = Boolean(state.debugHitboxes);
  document.getElementById('party-motion').value = state.rollSpeed ?? 50;
  document.getElementById('party-motion-value').value = `${round(state.rollSpeed ?? 50)}%`;
  document.getElementById('party-frequency').value = state.partyFrequency ?? 35;
  document.getElementById('party-frequency-value').value = `${round(state.partyFrequency ?? 35)}%`;
  document.getElementById('party-variation').value = state.partyVariation ?? 50;
  document.getElementById('party-variation-value').value = `${round(state.partyVariation ?? 50)}%`;
  document.getElementById('party-density').value = state.partyDensity ?? 50;
  document.getElementById('party-density-value').value = `${round(state.partyDensity ?? 50)}%`;
  document.getElementById('vary-speed').value = state.rollSpeed ?? 50;
  document.getElementById('vary-speed-value').value = `${round(state.rollSpeed ?? 50)}%`;
  syncForegroundColors();
  setActiveColor(document.getElementById('background-colors'), state.background);
  syncDirectionButtons();
  syncPolonaisePatternButtons();
  updateModeControls();
}

function resizeFromInputs() {
  const newWidth = constrain(Number(document.getElementById('canvas-width').value) || 1920, 200, 6000);
  const newHeight = constrain(Number(document.getElementById('canvas-height').value) || 1080, 200, 6000);
  if (newWidth === width && newHeight === height) return;
  const scaleX = newWidth / width;
  const scaleY = newHeight / height;
  state.garlands = (state.garlands || []).map(points => points.map(point => ({
    x: point.x * scaleX,
    y: point.y * scaleY
  })));
  resizeCanvas(newWidth, newHeight);
  clearLogoCache();
  particleSignature = '';
  tileSignature = '';
  fitCanvasPreview();
}

function fitCanvasPreview() {
  if (!canvasElement || !canvasContainer) return;
  const bounds = canvasContainer.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const scale = min(bounds.width / width, bounds.height / height);
  const previewDensity = constrain(ceil((window.devicePixelRatio || 1) * max(1, scale)), 1, 3);
  if (pixelDensity() !== previewDensity) {
    pixelDensity(previewDensity);
    clearLogoCache();
  }
  canvasElement.style.width = `${width * scale}px`;
  canvasElement.style.height = `${height * scale}px`;
}

function windowResized() {
  fitCanvasPreview();
}

function exportPNG() {
  exportingPNG = true;
  draw();
  saveCanvas('schets-2', 'png');
  exportingPNG = false;
  showStatus('PNG geëxporteerd');
}

function exportMP4() {
  if (exporting) return;
  if (!window.MediaRecorder || !canvasElement.captureStream) {
    return showStatus('MP4-export wordt niet ondersteund');
  }
  const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4']
    .find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) return showStatus('MP4-export wordt niet ondersteund in deze browser');

  const durationSeconds = constrain(
    Number(document.getElementById('export-duration').value) || 5,
    1,
    120
  );
  document.getElementById('export-duration').value = durationSeconds;
  const stream = canvasElement.captureStream(60);
  const chunks = [];
  const exportButton = document.getElementById('export-mp4');
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10000000 });
  recorder.addEventListener('dataavailable', event => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'schets-2.mp4';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    stream.getTracks().forEach(track => track.stop());
    exporting = false;
    exportButton.disabled = false;
    exportButton.textContent = 'MP4';
    showStatus('MP4 geëxporteerd');
  });

  exporting = true;
  exportButton.disabled = true;
  exportButton.textContent = 'Opnemen…';
  recorder.start();
  showStatus(`Opname gestart · ${durationSeconds} seconden`);
  setTimeout(() => recorder.stop(), durationSeconds * 1000);
}

function showStatus(message) {
  document.getElementById('status').textContent = message || '';
}
