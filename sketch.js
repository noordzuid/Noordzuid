// Add one SVG here; preload and the interface update automatically.
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

let state = {
  mode: 'logo',
  pattern: 'alternating',
  gridSize: 64,
  gridPhase: 0,
  focusOnLogo: false,
  showGrid: false,
  logoVariant: 'original',
  logoText: 'NOORDZUID',
  logoLayout: 'horizontal',
  noiseMotion: 'playful',
  noiseDensity: 'balanced',
  fall: false,
  foreground: '#F28EFF',
  background: '#270C13',
  logos: [
    { col: 7, row: 4, rotation: 90 },
    { col: 8, row: 4, rotation: 0 }
  ]
};

let keyframes = [];
let selectedKeyframe = 0;
let selectedLogo = 0;
const DEFAULT_KEYFRAME_DURATION = 800;
const DEFAULT_ANIMATION_DURATION = 600;
let easingType = 'easeInCubic';
let stagger = 0;
let playing = false;
let exporting = false;
let exportingPNG = false;
let animationStart = 0;
let canvasElement;
let canvasContainer;
let canvasResizeObserver;
let moves = {};
let logoImages = {};
let logoRenderCache = {};
let textGlyphCache = {};
let noiseIteration = 0;
let nextNoiseMoveAt = 0;
let fallBodies = [];
let lastFallUpdate = 0;
let playbackFallActive = false;
let playbackNoiseRuntime = null;
let playbackNoiseSources = {};
let fallResume = null;
let lastPlaybackFallState = null;
let fallReturnTransition = null;
let liveFallReturn = null;

function preload() {
  LOGO_VARIANTS.forEach(variant => {
    if (variant.path) logoImages[variant.id] = loadImage(variant.path);
  });
}

function setup() {
  const canvas = createCanvas(1000, 600);
  canvas.parent('canvas-container');
  canvasElement = canvas.elt;
  canvasContainer = document.getElementById('canvas-container');
  canvasElement.addEventListener('contextmenu', event => event.preventDefault());

  rectMode(CENTER);
  noStroke();

  fitCanvasPreview();
  if (window.ResizeObserver) {
    canvasResizeObserver = new ResizeObserver(fitCanvasPreview);
    canvasResizeObserver.observe(canvasContainer);
  }

  connectControls();
  applyLogoPreset();
  addKeyframe();
  syncControls();
  if (document.fonts) {
    document.fonts.load('100px Saans').then(clearLogoRenderCache);
  }
  showStatus('Linksklik om te rollen · rechtermuisklik om een cel te vullen of legen');
}

function draw() {
  if (!liveFallReturn) {
    updateNoiseMotion();
    updateFallMotion();
  }
  let drawingState = state;
  if (liveFallReturn && !playing && !exporting) {
    const elapsed = millis() - liveFallReturn.start;
    drawingState = fallReturnState(liveFallReturn, state, elapsed, liveFallReturn.duration);
    if (elapsed >= liveFallReturn.duration) {
      liveFallReturn = null;
      nextNoiseMoveAt = millis() + 250;
    }
  }

  if (playing || exporting) {
    const elapsed = millis() - animationStart;
    drawingState = playbackState(elapsed);

    if (isFalling(drawingState)) {
      drawingState = playbackFallState(drawingState);
    } else {
      playbackFallActive = false;
    }

    if (drawingState.mode === 'noise' && !isFalling(drawingState) && drawingState.noiseRunning !== false) {
      drawingState = playbackNoiseState(drawingState);
    } else {
      playbackNoiseRuntime = null;
    }

    if (playing && elapsed >= animationDuration()) {
      const finalState = cloneState(keyframes[keyframes.length - 1]);

      // Keep the final physics pose so stopping playback cannot snap back to
      // the grid positions stored in the fall keyframe.
      if (isFalling(finalState) && isFalling(drawingState)) {
        finalState.logos = drawingState.logos.map(logo => ({ ...logo }));
      }
      if (finalState.mode === 'noise' && drawingState.mode === 'noise') {
        finalState.logos = (playbackNoiseRuntime?.state.logos || drawingState.logos)
          .map(logo => ({ ...logo }));
      }

      state = finalState;
      selectedKeyframe = keyframes.length - 1;
      stopPlayback();
      syncControls();
    }
  }

  background(drawingState.background);

  const visibleLogos = drawingState.logos.map((logo, index) => (
    playing || exporting ? logo : movingLogo(index, logo)
  ));
  const drawingGrid = viewGridMetrics({ ...drawingState, logos: visibleLogos });

  if (drawingState.showGrid && !exporting && !exportingPNG) {
    drawGrid(drawingGrid, drawingState.foreground);
  }

  visibleLogos.forEach((visibleLogo, index) => {
    drawLogo(visibleLogo, drawingState, drawingGrid, index);

    if (drawingState.showGrid && index === selectedLogo && !exporting && !exportingPNG) {
      drawSelectionIndicator(visibleLogo, drawingGrid);
    }
  });
}

function zoomLevels() {
  const gutter = 10 / 64;
  const minimumRows = ceil(((height / 400 + gutter) / (1 + gutter)) * 2) / 2;
  const maximumRows = floor(((height / 32 + gutter) / (1 + gutter)) * 2) / 2;
  const levels = [];

  // Each slider step changes the vertical fit by half a cell. Only the
  // resulting pixel size is stored in state/keyframes, never this index.
  for (let rows = maximumRows; rows >= minimumRows; rows -= 0.5) {
    levels.push(height / (rows * (1 + gutter) - gutter));
  }
  return levels;
}

function syncZoomControl() {
  const control = document.getElementById('grid-size');
  const levels = zoomLevels();
  let nearest = 0;
  levels.forEach((size, index) => {
    if (abs(size - state.gridSize) < abs(levels[nearest] - state.gridSize)) nearest = index;
  });
  control.max = levels.length - 1;
  control.value = nearest;
  control.title = `${state.gridSize.toFixed(1)} px`;
}

function gridMetrics(gridSize) {
  const cell = gridSize;
  const gap = cell * (10 / 64);
  const pitch = cell + gap;
  let cols = max(3, ceil((width + gap) / pitch));
  let rows = max(3, ceil((height + gap) / pitch));

  // Odd dimensions keep a true centre cell; rounding up clips edge cells evenly.
  if (cols % 2 === 0) cols++;
  if (rows % 2 === 0) rows++;

  const gridWidth = cols * cell + (cols - 1) * gap;
  const gridHeight = rows * cell + (rows - 1) * gap;

  return {
    cols,
    rows,
    gridWidth,
    gridHeight,
    gap,
    cell,
    pitch,
    left: (width - gridWidth) / 2,
    top: (height - gridHeight) / 2
  };
}

function cellRotation(col, row, nearRotation = 0, phase = state.gridPhase || 0) {
  const base = ((round(col) + round(row) + phase) & 1) * 90;
  return base + round((nearRotation - base) / 360) * 360;
}

function remapLogoBetweenGrids(logo, fromGrid, toGrid) {
  const center = cellCenter(logo.col, logo.row, fromGrid);
  return { ...logo, ...canvasPointToLogo(center, logo.rotation, toGrid) };
}

function logoGridOffset(source) {
  if (source.mode !== 'logo' || source.logos.length !== 2) return { x: 0, y: 0 };
  return source.logoLayout === 'vertical' ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 };
}

function transitionViewport(from, to, progress) {
  const fromGrid = gridMetrics(from.gridSize);
  const toGrid = gridMetrics(to.gridSize);
  const fromOffset = logoGridOffset(from);
  const toOffset = logoGridOffset(to);
  return {
    gridOrigin: {
      left: lerp(fromGrid.left, toGrid.left, progress),
      top: lerp(fromGrid.top, toGrid.top, progress)
    },
    viewOffset: {
      x: lerp(fromOffset.x, toOffset.x, progress),
      y: lerp(fromOffset.y, toOffset.y, progress)
    }
  };
}

function viewGridMetrics(drawingState) {
  const grid = gridMetrics(drawingState.gridSize);
  if (drawingState.gridOrigin) Object.assign(grid, drawingState.gridOrigin);
  const offset = drawingState.viewOffset || logoGridOffset(drawingState);
  grid.left += offset.x * grid.pitch;
  grid.top += offset.y * grid.pitch;
  const focusAmount = drawingState.viewFocus ?? (drawingState.focusOnLogo ? 1 : 0);
  if (focusAmount <= 0 || !drawingState.logos.length) return grid;

  const focusLogos = drawingState.focusLogos?.length
    ? drawingState.focusLogos
    : drawingState.mode === 'logo'
      ? drawingState.logos
      : [drawingState.logos[constrain(selectedLogo, 0, drawingState.logos.length - 1)]];
  const logoCount = focusLogos.length;
  const centerCol = focusLogos.reduce((sum, logo) => sum + logo.col, 0) / logoCount;
  const centerRow = focusLogos.reduce((sum, logo) => sum + logo.row, 0) / logoCount;

  // Focus is a camera translation only: cell size and zoom range stay identical.
  return {
    ...grid,
    left: lerp(grid.left, width / 2 - centerCol * grid.pitch - grid.cell / 2, focusAmount),
    top: lerp(grid.top, height / 2 - centerRow * grid.pitch - grid.cell / 2, focusAmount)
  };
}

function drawGrid(grid, gridColor) {
  const lineColor = color(gridColor);
  lineColor.setAlpha(85);
  stroke(lineColor);
  strokeWeight(1);

  noFill();
  rectMode(CORNER);

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      rect(
        grid.left + col * grid.pitch,
        grid.top + row * grid.pitch,
        grid.cell,
        grid.cell
      );
    }
  }

  rectMode(CENTER);
  noStroke();
}

function drawLogo(logo, drawingState, grid, logoIndex) {
  const length = grid.cell;
  const center = cellCenter(logo.col, logo.row, grid);
  const x = center.x;
  const y = center.y;

  push();
  translate(x, y);
  rotate(radians(logo.rotation));

  const logoVariant = drawingState.logoVariant === 'vary'
    ? (logo.variant || noiseVariantFor(round(logo.col), round(logo.row), 0, logoIndex))
    : drawingState.logoVariant;

  if (logoVariant === 'text') {
    drawTextLogo(
      drawingState,
      logo.glyphIndex ?? logoIndex,
      length
    );
  } else {
    const logoImage = renderedLogo(
      logoVariant || 'original',
      drawingState.foreground,
      length
    );
    imageMode(CENTER);
    image(logoImage, 0, 0, length, length);
  }

  pop();
}

function drawTextLogo(drawingState, logoIndex, size) {
  const content = drawingState.logoText || 'NOORDZUID';
  const characters = Array.from(content.replace(/\s/g, ''));
  const character = characters[logoIndex % max(1, characters.length)] || 'N';
  const glyph = renderedTextGlyph(character);

  push();
  imageMode(CENTER);
  tint(drawingState.foreground);
  image(glyph, 0, 0, size, size);
  noTint();
  pop();
}

function renderedTextGlyph(character) {
  const cacheKey = `${character}-${pixelDensity()}`;
  if (textGlyphCache[cacheKey]) return textGlyphCache[cacheKey];

  if (Object.keys(textGlyphCache).length >= 32) {
    Object.values(textGlyphCache).forEach(buffer => buffer.remove());
    textGlyphCache = {};
  }

  // Render a glyph once at a generous fixed resolution. Zooming can then use
  // the GPU to scale this bitmap instead of laying out and rasterising every
  // visible letter again on every animation frame.
  const bufferSize = 512;
  const measureSize = 100;
  const buffer = createGraphics(bufferSize, bufferSize);
  buffer.clear();
  buffer.noStroke();
  buffer.fill(255);
  buffer.textFont('Saans');
  buffer.textStyle(NORMAL);
  buffer.textSize(measureSize);

  let metrics = buffer.drawingContext.measureText(character);
  const hasExactBounds = Number.isFinite(metrics.actualBoundingBoxLeft) &&
    Number.isFinite(metrics.actualBoundingBoxRight) &&
    Number.isFinite(metrics.actualBoundingBoxAscent) &&
    Number.isFinite(metrics.actualBoundingBoxDescent);
  const measuredWidth = hasExactBounds
    ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight
    : buffer.textWidth(character);
  const measuredHeight = hasExactBounds
    ? metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    : buffer.textAscent() + buffer.textDescent();
  const fittedSize = measureSize * (bufferSize * 0.96) /
    max(measuredWidth, measuredHeight, 1);

  buffer.textSize(fittedSize);
  if (hasExactBounds) {
    buffer.textAlign(LEFT, BASELINE);
    metrics = buffer.drawingContext.measureText(character);
    const x = bufferSize / 2 +
      (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2;
    const y = bufferSize / 2 +
      (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    buffer.text(character, x, y);
  } else {
    buffer.textAlign(CENTER, CENTER);
    buffer.text(character, bufferSize / 2, bufferSize / 2);
  }

  textGlyphCache[cacheKey] = buffer;
  return buffer;
}

function renderedLogo(variantId, foreground, size) {
  const cacheKey = `${variantId}-${foreground}-${round(size)}-${pixelDensity()}`;
  if (logoRenderCache[cacheKey]) return logoRenderCache[cacheKey];

  if (Object.keys(logoRenderCache).length >= 80) {
    clearLogoRenderCache();
  }

  const source = logoImages[variantId] || logoImages.original;
  const bufferSize = max(1, round(size));
  const buffer = createGraphics(bufferSize, bufferSize);
  const imageScale = min(bufferSize / source.width, bufferSize / source.height);

  buffer.clear();
  buffer.imageMode(CENTER);
  buffer.image(
    source,
    bufferSize / 2,
    bufferSize / 2,
    source.width * imageScale,
    source.height * imageScale
  );
  buffer.drawingContext.globalCompositeOperation = 'source-in';
  buffer.noStroke();
  buffer.fill(foreground);
  buffer.rectMode(CORNER);
  buffer.rect(0, 0, bufferSize, bufferSize);
  buffer.drawingContext.globalCompositeOperation = 'source-over';

  logoRenderCache[cacheKey] = buffer;
  return buffer;
}

function clearLogoRenderCache() {
  Object.values(logoRenderCache).forEach(buffer => buffer.remove());
  logoRenderCache = {};
  Object.values(textGlyphCache).forEach(buffer => buffer.remove());
  textGlyphCache = {};
}

function drawSelectionIndicator(logo, grid) {
  const col = constrain(round(logo.col), 0, grid.cols - 1);
  const row = constrain(round(logo.row), 0, grid.rows - 1);

  push();
  rectMode(CORNER);
  noFill();
  stroke(255);
  strokeWeight(1);
  rect(
    grid.left + col * grid.pitch,
    grid.top + row * grid.pitch,
    grid.cell,
    grid.cell
  );
  pop();
}

function mousePressed(event) {
  if (event.target !== canvasElement || exporting) return;

  const bounds = canvasElement.getBoundingClientRect();
  const canvasX = (event.clientX - bounds.left) * width / bounds.width;
  const canvasY = (event.clientY - bounds.top) * height / bounds.height;
  const interactionState = playing
    ? playbackState(millis() - animationStart)
    : state;
  const interactionLogos = interactionState.logos.map((logo, index) => (
    playing ? logo : movingLogo(index, logo)
  ));
  const grid = viewGridMetrics({ ...interactionState, logos: interactionLogos });

  if (
    canvasX < grid.left ||
    canvasX > grid.left + grid.gridWidth ||
    canvasY < grid.top ||
    canvasY > grid.top + grid.gridHeight
  ) return;

  const localX = canvasX - grid.left;
  const localY = canvasY - grid.top;
  const col = constrain(floor(localX / grid.pitch), 0, grid.cols - 1);
  const row = constrain(floor(localY / grid.pitch), 0, grid.rows - 1);

  if (localX - col * grid.pitch > grid.cell || localY - row * grid.pitch > grid.cell) return;

  if (event.button === 2) {
    if (playing || Object.keys(moves).length > 0) return false;

    const logoIndex = state.logos.findIndex(logo => (
      round(logo.col) === col && round(logo.row) === row
    ));

    if (logoIndex >= 0) {
      if (state.mode === 'logo' && state.logos.length === 1) {
        showStatus('Logo-modus gebruikt minimaal 1 logo');
        return false;
      }

      state.logos.splice(logoIndex, 1);
      selectedLogo = constrain(selectedLogo, 0, max(0, state.logos.length - 1));
      showStatus('Logo verwijderd');
    } else {
      if (state.mode === 'logo' && state.logos.length === 2) {
        showStatus('Logo-modus gebruikt maximaal 2 logo’s');
        return false;
      }

      state.logos.push({
        col,
        row,
        rotation: cellRotation(col, row)
      });
      selectedLogo = state.logos.length - 1;
      showStatus('Logo toegevoegd');
    }

    moves = {};
    if (state.mode === 'logo') {
      syncOptionButtons();
    }
    autoUpdateKeyframe({ preserveFallLayout: false });
    return false;
  }

  const clickedLogo = interactionLogos.findIndex(visibleLogo => {
    const center = cellCenter(visibleLogo.col, visibleLogo.row, grid);
    return dist(canvasX, canvasY, center.x, center.y) <= grid.cell * 0.52;
  });

  if (clickedLogo >= 0) {
    selectedLogo = clickedLogo;
    showStatus(`Logo ${clickedLogo + 1} geselecteerd`);
    return;
  }

  if (playing || Object.keys(moves).length > 0) return;

  if (!state.logos.length) {
    showStatus('Voeg eerst een logo toe');
    return;
  }

  if (isFalling(state)) {
    showStatus('Valmodus beweegt vanzelf');
    return;
  }

  rollLogo(selectedLogo, col, row);
}

function rollLogo(index, targetCol, targetRow) {
  const from = { ...state.logos[index] };
  const blocked = state.logos.filter((logo, logoIndex) => logoIndex !== index);
  const path = buildRollPath(from, targetCol, targetRow, gridMetrics(state.gridSize), blocked);

  if (!path.length) {
    showStatus('Geen vrije route naar deze cel');
    return;
  }

  const to = path[path.length - 1];

  if (from.col === to.col && from.row === to.row) return;

  moves[index] = {
    path,
    start: millis(),
    duration: timingFromControls().animationDuration
  };
  if (state.logoVariant === 'vary') {
    moves[index].fromVariant = from.variant || noiseVariantFor(from.col, from.row, 0, index);
    to.variant = noiseVariantFor(to.col, to.row, 1, index);
    moves[index].toVariant = to.variant;
  }

  state.logos[index] = { ...to };
  autoUpdateKeyframe();
  showStatus('Logo rolt naar de gekozen cel');
}

function movingLogo(index, fallback) {
  const move = moves[index];
  if (!move) return fallback;

  const elapsed = millis() - move.start;
  if (elapsed >= move.duration) {
    delete moves[index];
    return fallback;
  }

  const raw = elapsed / move.duration;
  const visibleLogo = {
    ...fallback,
    ...rollPathPose(move.path, raw, state.gridSize)
  };

  if (move.fromVariant || move.toVariant) {
    visibleLogo.variant = raw < 0.5
      ? (move.fromVariant || move.toVariant)
      : (move.toVariant || move.fromVariant);
  }

  return visibleLogo;
}

function buildRollPath(from, targetCol, targetRow, grid, blocked = [], phase = state.gridPhase || 0) {
  if (from.col === targetCol && from.row === targetRow) return [{ ...from }];

  const blockedCells = new Set(blocked.map(logo => `${logo.col},${logo.row}`));
  const queue = [{ col: from.col, row: from.row }];
  const parents = new Map([[`${from.col},${from.row}`, null]]);
  let targetFound = false;

  while (queue.length && !targetFound) {
    const current = queue.shift();
    const directions = [
      { col: 1, row: 0 },
      { col: -1, row: 0 },
      { col: 0, row: 1 },
      { col: 0, row: -1 }
    ].sort((a, b) => {
      const distanceA = abs(targetCol - current.col - a.col) + abs(targetRow - current.row - a.row);
      const distanceB = abs(targetCol - current.col - b.col) + abs(targetRow - current.row - b.row);
      return distanceA - distanceB;
    });

    for (const direction of directions) {
      const next = {
        col: current.col + direction.col,
        row: current.row + direction.row
      };
      const key = `${next.col},${next.row}`;

      if (
        next.col < 0 || next.col >= grid.cols ||
        next.row < 0 || next.row >= grid.rows ||
        blockedCells.has(key) || parents.has(key)
      ) continue;

      parents.set(key, current);
      queue.push(next);

      if (next.col === targetCol && next.row === targetRow) {
        targetFound = true;
        break;
      }
    }
  }

  if (!targetFound) return [];

  const cells = [];
  let current = { col: targetCol, row: targetRow };

  while (current) {
    cells.unshift(current);
    current = parents.get(`${current.col},${current.row}`);
  }

  let rotation = from.rotation;
  return cells.map((cell, index) => {
    if (index > 0) {
      rotation += anchoredTurn(cells[index - 1], cell);
    }

    return { ...cell, rotation };
  });
}

function anchoredTurn(from, to) {
  const directionX = Math.sign(to.col - from.col);
  const directionY = Math.sign(to.row - from.row);

  if (directionX !== 0) return directionX * 90;
  if (directionY !== 0) return directionY * 90;
  return 0;
}

function rollPathPose(path, progress, gridSize, easing = easingType) {
  const grid = gridMetrics(gridSize);

  if (path.length === 1) {
    return { ...path[0] };
  }

  const totalWeight = pathWeight(path);
  const distance = constrain(progress, 0, 1) * totalWeight;

  if (distance >= totalWeight) return { ...path[path.length - 1] };

  let travelled = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const weight = rollStepWeight(path[i], path[i + 1]);

    if (distance <= travelled + weight) {
      const localProgress = constrain((distance - travelled) / weight, 0, 1);
      const easedProgress = constrain(applyEasing(localProgress, easing), 0, 1);
      return rollStepPose(path[i], path[i + 1], easedProgress, grid);
    }

    travelled += weight;
  }

  return { ...path[path.length - 1] };
}

function rollStepWeight(from, to) {
  return 1;
}

function pathWeight(path) {
  let weight = 0;

  for (let i = 0; i < path.length - 1; i++) {
    weight += rollStepWeight(path[i], path[i + 1]);
  }

  return weight;
}

function rollStepPose(from, to, progress, grid) {
  const directionX = to.col - from.col;
  const directionY = to.row - from.row;
  const turn = to.rotation - from.rotation;
  const start = cellCenter(from.col, from.row, grid);
  let pivot;

  if (directionX !== 0) {
    pivot = {
      x: start.x + directionX * grid.cell / 2,
      y: start.y + grid.cell / 2
    };
  } else {
    pivot = {
      x: start.x - grid.cell / 2,
      y: start.y + directionY * grid.cell / 2
    };
  }

  const rotation = lerp(from.rotation, to.rotation, progress);
  const center = rotatePoint(
    start,
    pivot,
    radians((to.rotation - from.rotation) * progress)
  );
  // Pivot on the actual logo corner; cross the gutter smoothly instead of
  // rotating around an imaginary corner halfway into the empty padding.
  center.x += directionX * grid.gap * progress;
  center.y += directionY * grid.gap * progress;

  return canvasPointToLogo(
    center,
    rotation,
    grid
  );
}

function cellCenter(col, row, grid) {
  return {
    x: grid.left + col * grid.pitch + grid.cell / 2,
    y: grid.top + row * grid.pitch + grid.cell / 2
  };
}

function rotatePoint(point, pivot, angle) {
  const x = point.x - pivot.x;
  const y = point.y - pivot.y;

  return {
    x: pivot.x + x * cos(angle) - y * sin(angle),
    y: pivot.y + x * sin(angle) + y * cos(angle)
  };
}

function canvasPointToLogo(point, rotation, grid) {
  return {
    col: (point.x - grid.left - grid.cell / 2) / grid.pitch,
    row: (point.y - grid.top - grid.cell / 2) / grid.pitch,
    rotation
  };
}

function syncOptionButtons() {
  const values = {
    pattern: state.pattern,
    'logo-layout': state.logos.length === 1 ? 'single' : state.logoLayout,
    'noise-motion': state.noiseMotion,
    'noise-density': state.noiseDensity
  };
  Object.entries(values).forEach(([id, value]) => {
    document.getElementById(id).querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.value === value));
    });
  });
}

function connectControls() {
  const logoVariantControl = document.getElementById('logo-variant');
  const modeControl = document.getElementById('mode');

  LOGO_VARIANTS.forEach(variant => {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variant.label;
    logoVariantControl.appendChild(option);
  });

  logoVariantControl.value = state.logoVariant;
  logoVariantControl.addEventListener('change', event => {
    state.logoVariant = event.target.value;
    if (state.logoVariant === 'vary') applyNoiseStyles();
    updateTextControls();
    autoUpdateKeyframe();
  });
  document.getElementById('logo-text').addEventListener('input', event => {
    state.logoText = event.target.value;
    autoUpdateKeyframe();
  });

  modeControl.addEventListener('change', event => {
    setMode(event.target.value);
    autoUpdateKeyframe({ preserveFallLayout: false });
  });

  document.getElementById('grid-size').addEventListener('input', event => {
    const oldGrid = gridMetrics(state.gridSize);
    const newSize = zoomLevels()[Number(event.target.value)];
    const newGrid = gridMetrics(newSize);
    const shiftCol = (newGrid.cols - oldGrid.cols) / 2;
    const shiftRow = (newGrid.rows - oldGrid.rows) / 2;

    state.gridPhase = ((state.gridPhase || 0) - shiftCol - shiftRow) % 2;
    if (state.gridPhase < 0) state.gridPhase += 2;

    if (isFalling(state)) {
      state.logos = state.logos.map(logo => remapLogoBetweenGrids(logo, oldGrid, newGrid));
      if (state.preFallLogos) {
        state.preFallLogos = state.preFallLogos.map(logo => remapLogoBetweenGrids(logo, oldGrid, newGrid));
      }
      if (fallResume) {
        Object.values(fallResume.moves).forEach(move => {
          move.path = move.path.map(logo => ({
            ...logo, col: logo.col + shiftCol, row: logo.row + shiftRow
          }));
        });
      }
      const currentKeyframe = keyframes[selectedKeyframe];
      if (currentKeyframe && isFalling(currentKeyframe)) {
        currentKeyframe.logos = currentKeyframe.logos.map(logo => (
          remapLogoBetweenGrids(logo, oldGrid, newGrid)
        ));
      }
    } else {
      state.logos.forEach(logo => {
        logo.col += shiftCol;
        logo.row += shiftRow;
      });
    }

    state.gridSize = newSize;
    syncZoomControl();
    moves = {};

    autoUpdateKeyframe();
  });

  document.getElementById('show-grid').addEventListener('change', event => {
    state.showGrid = event.target.checked;
    autoUpdateKeyframe();
  });
  document.getElementById('focus-logo').addEventListener('change', event => {
    state.focusOnLogo = event.target.checked;
    autoUpdateKeyframe();
  });

  ['pattern', 'logo-layout', 'noise-motion', 'noise-density'].forEach(id => {
    document.getElementById(id).querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => {
        const value = button.dataset.value;
        if (id === 'pattern') { state.pattern = value; applyPattern(); }
        if (id === 'logo-layout') { state.logoLayout = value; applyLogoPreset(); }
        if (id === 'noise-motion') { state.noiseMotion = value; nextNoiseMoveAt = 0; }
        if (id === 'noise-density') { state.noiseDensity = value; applyNoiseField(); }
        if (isFalling(state) && id !== 'noise-motion') {
          state.preFallLogos = state.logos.map(logo => ({ ...logo }));
          fallResume = null;
        }
        syncOptionButtons();
        autoUpdateKeyframe({ preserveFallLayout: id === 'noise-motion' });
      });
    });
  });
  document.getElementById('fall').addEventListener('change', event => {
    const fallen = cloneState(state);
    liveFallReturn = null;
    state.fall = event.target.checked;
    if (state.fall) {
      state.preFallLogos = state.logos.map(logo => ({ ...logo }));
      fallResume = { moves, pausedAt: millis(), nextMoveAt: nextNoiseMoveAt };
    }
    moves = {};
    fallBodies = [];
    playbackFallActive = false;
    if (state.fall) resetFallBodies();
    else {
      const original = state.preFallLogos || keyframes[selectedKeyframe]?.preFallLogos || keyframes[selectedKeyframe]?.logos;
      if (original) state.logos = original.map(logo => ({ ...logo }));
      liveFallReturn = {
        source: fallen,
        items: fallReturnItems(fallen, state),
        start: millis(),
        duration: timingFromControls().animationDuration
      };
      fallResume = null;
    }
    autoUpdateKeyframe({ preserveFallLayout: false });
  });

  connectColors('foreground-colors', 'foreground');
  connectColors('background-colors', 'background');
  document.getElementById('add-keyframe').addEventListener('click', addKeyframe);
  document.getElementById('remove-keyframe').addEventListener('click', removeKeyframe);
  document.getElementById('keyframe-list').addEventListener('change', loadKeyframe);
  document.getElementById('play').addEventListener('click', togglePlayback);
  document.getElementById('easing').addEventListener('change', event => {
    easingType = event.target.value;
    autoUpdateKeyframe();
  });
  document.getElementById('stagger').addEventListener('input', event => {
    stagger = Number(event.target.value);
    autoUpdateKeyframe();
  });
  document.getElementById('duration').addEventListener('change', event => {
    const duration = max(100, Number(event.target.value) || DEFAULT_KEYFRAME_DURATION);
    event.target.value = duration;
    const animationInput = document.getElementById('animation-duration');
    animationInput.value = min(duration, Number(animationInput.value) || DEFAULT_ANIMATION_DURATION);
    autoUpdateKeyframe();
  });
  document.getElementById('animation-duration').addEventListener('change', event => {
    const duration = max(100, Number(document.getElementById('duration').value) || DEFAULT_KEYFRAME_DURATION);
    event.target.value = constrain(
      Number(event.target.value) || DEFAULT_ANIMATION_DURATION,
      100,
      duration
    );
    autoUpdateKeyframe();
  });
  document.getElementById('canvas-width').addEventListener('change', resizeFromInputs);
  document.getElementById('canvas-height').addEventListener('change', resizeFromInputs);
  document.getElementById('export-png').addEventListener('click', exportPNG);
  document.getElementById('export-mp4').addEventListener('click', exportMP4);
}

function applyPattern() {
  state.mode = 'pattern';
  const pattern = state.pattern;
  state.pattern = pattern;
  const cells = patternCells(pattern, gridMetrics(state.gridSize));

  state.logos = cells.map(cell => ({
    col: cell.col,
    row: cell.row,
    rotation: cellRotation(cell.col, cell.row)
  }));
  if (state.logoVariant === 'vary') applyNoiseStyles();
  if (isFalling(state)) resetFallBodies();

  selectedLogo = 0;
  moves = {};
  showStatus('Patroon toegepast');
}

function setMode(mode) {
  state.mode = mode;
  moves = {};
  fallBodies = [];
  playbackFallActive = false;
  updateModeControls();

  if (mode === 'noise') {
    applyNoiseField();
  } else if (mode === 'logo') {
    applyLogoPreset();
  } else if (mode === 'pattern') {
    applyPattern();
  }
  if (isFalling(state)) resetFallBodies();
}

function updateModeControls() {
  document.getElementById('mode-settings').hidden = false;
  ['pattern', 'noise', 'logo'].forEach(mode => {
    document.getElementById(`${mode}-controls`).hidden = state.mode !== mode;
  });
  updateTextControls();
}

function updateTextControls() {
  document.getElementById('text-controls').hidden = state.logoVariant !== 'text';
}

function applyNoiseField() {
  const grid = gridMetrics(state.gridSize);
  const cells = [];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const value = noise(col * 0.31, row * 0.31, noiseIteration * 0.21);
      cells.push({
        col,
        row,
        score: value
      });
    }
  }

  const density = {
    airy: 0.2,
    balanced: 0.34,
    full: 0.48
  }[state.noiseDensity || 'balanced'];
  const amount = max(2, round(cells.length * density));
  state.logos = cells
    .sort((a, b) => b.score - a.score)
    .slice(0, amount)
    .map(({ col, row }, index) => ({
      col,
      row,
      rotation: cellRotation(col, row),
      ...(state.logoVariant === 'vary'
        ? { variant: noiseVariantFor(col, row, noiseIteration, index) }
        : {})
    }));
  selectedLogo = 0;
  noiseIteration++;
  moves = {};
  nextNoiseMoveAt = millis() + 250;
  showStatus('Noise veld beweegt automatisch');
  if (isFalling(state)) resetFallBodies();
}

function applyNoiseStep() {
  if (state.mode !== 'noise' || !state.logos.length) return;

  const grid = gridMetrics(state.gridSize);
  const stepStart = millis();
  const startingCells = new Set(state.logos.map(logo => `${logo.col},${logo.row}`));
  const targets = new Set();
  const settings = noiseMotionSettings();
  const nextLogos = state.logos.map(logo => ({ ...logo }));
  const previousVariants = state.logos.map(logo => logo.variant || 'original');
  moves = {};

  state.logos.forEach((logo, logoIndex) => {
    if (random() > settings.amount) {
      targets.add(`${logo.col},${logo.row}`);
      return;
    }

    const angle = noise(
      logo.col * settings.spread,
      logo.row * settings.spread,
      noiseIteration * 0.11
    ) * TWO_PI * 2;
    const candidates = [
      { col: logo.col + 1, row: logo.row },
      { col: logo.col - 1, row: logo.row },
      { col: logo.col, row: logo.row + 1 },
      { col: logo.col, row: logo.row - 1 }
    ]
      .filter(cell => (
        cell.col >= 0 && cell.col < grid.cols &&
        cell.row >= 0 && cell.row < grid.rows &&
        !startingCells.has(`${cell.col},${cell.row}`) &&
        !targets.has(`${cell.col},${cell.row}`)
      ))
      .sort((a, b) => {
        const scoreA = (a.col - logo.col) * cos(angle) + (a.row - logo.row) * sin(angle);
        const scoreB = (b.col - logo.col) * cos(angle) + (b.row - logo.row) * sin(angle);
        return scoreB - scoreA;
      });

    if (!candidates.length) {
      targets.add(`${logo.col},${logo.row}`);
      return;
    }

    const target = candidates[0];
    targets.add(`${target.col},${target.row}`);
    const path = buildRollPath(logo, target.col, target.row, grid, state.logos.filter(other => other !== logo));
    if (!path.length) return;

    const endpoint = path[path.length - 1];
    nextLogos[logoIndex] = { ...endpoint };
    moves[logoIndex] = {
      path,
      start: stepStart,
      duration: settings.duration
    };
  });

  state.logos = nextLogos;
  if (state.logoVariant === 'vary') {
    Object.keys(moves).forEach(indexKey => {
      const logoIndex = Number(indexKey);
      const logo = state.logos[logoIndex];
      logo.variant = noiseVariantFor(
        logo.col,
        logo.row,
        noiseIteration + 1,
        logoIndex
      );
      moves[logoIndex].fromVariant = previousVariants[logoIndex];
      moves[logoIndex].toVariant = logo.variant;
    });
  }
  noiseIteration++;
  nextNoiseMoveAt = millis() + settings.duration + settings.pause;
}

function applyNoiseStyles(iteration = noiseIteration) {
  state.logos.forEach((logo, index) => {
    logo.variant = noiseVariantFor(logo.col, logo.row, iteration, index);
  });
}

function noiseVariantFor(col, row, iteration, index = 0) {
  const variants = LOGO_VARIANTS.filter(variant => variant.path);
  const seed = sin(
    (col + 1) * 12.9898 +
    (row + 1) * 78.233 +
    (iteration + 1) * 37.719 +
    index * 0.173
  ) * 43758.5453;
  const value = seed - floor(seed);
  return variants[floor(value * variants.length)].id;
}

function noiseMotionSettings() {
  const settings = {
    calm: { duration: 760, pause: 260, amount: 0.24, spread: 0.12 },
    playful: { duration: 480, pause: 100, amount: 0.48, spread: 0.22 },
    wild: { duration: 280, pause: 30, amount: 0.76, spread: 0.38 }
  }[state.noiseMotion || 'playful'];
  const duration = playing || exporting
    ? max(100, Number(state.animationDuration) || DEFAULT_ANIMATION_DURATION)
    : timingFromControls().animationDuration;
  return { ...settings, duration };
}

function updateNoiseMotion() {
  if (
    state.mode !== 'noise' || isFalling(state) || playing || exporting || exportingPNG ||
    millis() < nextNoiseMoveAt || Object.keys(moves).length > 0
  ) return;

  applyNoiseStep();
}

function playbackNoiseState(drawingState) {
  if (!playbackNoiseRuntime) {
    playbackNoiseRuntime = {
      state: cloneState(drawingState.noiseSeed || drawingState),
      moves: {},
      iteration: noiseIteration,
      nextMoveAt: millis()
    };
  }

  // Reuse the exact preview engine, but keep its mutable state separate from
  // the stored keyframes. This also lets a single keyframe keep generating
  // noise for its entire playback/export duration.
  playbackNoiseRuntime.state = {
    ...cloneState(drawingState),
    logos: playbackNoiseRuntime.state.logos
  };

  const savedState = state;
  const savedMoves = moves;
  const savedIteration = noiseIteration;
  const savedNextMoveAt = nextNoiseMoveAt;
  let visibleLogos;

  try {
    state = playbackNoiseRuntime.state;
    moves = playbackNoiseRuntime.moves;
    noiseIteration = playbackNoiseRuntime.iteration;
    nextNoiseMoveAt = playbackNoiseRuntime.nextMoveAt;

    if (millis() >= nextNoiseMoveAt && Object.keys(moves).length === 0) {
      applyNoiseStep();
    }

    visibleLogos = state.logos.map((logo, index) => movingLogo(index, logo));
    playbackNoiseRuntime.state = state;
    playbackNoiseRuntime.moves = moves;
    playbackNoiseRuntime.iteration = noiseIteration;
    playbackNoiseRuntime.nextMoveAt = nextNoiseMoveAt;
  } finally {
    state = savedState;
    moves = savedMoves;
    noiseIteration = savedIteration;
    nextNoiseMoveAt = savedNextMoveAt;
  }

  playbackNoiseRuntime.visibleState = {
    ...drawingState,
    logos: visibleLogos
  };
  return playbackNoiseRuntime.visibleState;
}

function isFalling(source = state) {
  return Boolean(source.fall) || source.mode === 'fall';
}

function resetFallBodies(sourceState = state) {
  const grid = gridMetrics(sourceState.gridSize);
  const view = viewGridMetrics(sourceState);
  const viewportLeft = grid.left - view.left;
  const viewportTop = grid.top - view.top;

  fallBodies = sourceState.logos.map((logo, index) => {
    const center = cellCenter(logo.col, logo.row, grid);
    const angle = radians(logo.rotation);
    const extent = grid.cell * 0.5 * (abs(cos(angle)) + abs(sin(angle))) + 3;
    return {
      x: center.x,
      y: center.y,
      vx: sin((index + 1) * 2.17) * 18,
      vy: 0,
      rotation: logo.rotation,
      angularVelocity: sin((index + 1) * 1.37) * 4,
      variant: logo.variant,
      glyphIndex: logo.glyphIndex,
      bounds: {
        left: min(viewportLeft, center.x - extent),
        right: max(viewportLeft + width, center.x + extent),
        top: min(viewportTop, center.y - extent),
        bottom: max(viewportTop + height, center.y + extent)
      }
    };
  });
  lastFallUpdate = millis();
}

function updateFallMotion() {
  if (!isFalling(state) || playing || exporting || exportingPNG) return;

  if (fallBodies.length !== state.logos.length) resetFallBodies();
  if (!fallBodies.length) return;

  state.logos = stepFallBodies(state);
}

function playbackFallState(drawingState) {
  // Once a fall sequence has started, its bodies remain authoritative across
  // every consecutive fall keyframe. A temporary logo-count difference in the
  // keyframe interpolation must never rebuild the whole scene on its grid.
  if (!playbackFallActive) {
    resetFallBodies(drawingState);
    playbackFallActive = true;
  }

  lastPlaybackFallState = {
    ...drawingState,
    logos: stepFallBodies(drawingState)
  };
  return lastPlaybackFallState;
}

function stepFallBodies(sourceState) {
  if (!fallBodies.length) return [];

  const now = millis();
  const elapsed = constrain((now - lastFallUpdate) / 1000, 0, 0.04);
  lastFallUpdate = now;
  const grid = gridMetrics(sourceState.gridSize);
  const view = viewGridMetrics(sourceState);
  const viewportLeft = grid.left - view.left;
  const viewportTop = grid.top - view.top;
  const collisionPadding = 3;
  const steps = 4;
  const dt = elapsed / steps;

  for (let step = 0; elapsed > 0 && step < steps; step++) {
    fallBodies.forEach(body => {
      body.vy += 980 * dt;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.rotation += body.angularVelocity * dt;

      const angle = radians(body.rotation);
      const extent = grid.cell * 0.5 * (abs(cos(angle)) + abs(sin(angle))) + collisionPadding;

      const bounds = body.bounds;
      if (body.x - extent >= viewportLeft) bounds.left = viewportLeft;
      if (body.x + extent <= viewportLeft + width) bounds.right = viewportLeft + width;
      if (body.y - extent >= viewportTop) bounds.top = viewportTop;
      if (body.y + extent <= viewportTop + height) bounds.bottom = viewportTop + height;
      if (body.x - extent < bounds.left) {
        body.x = bounds.left + extent;
        body.vx = abs(body.vx) * 0.42;
        body.angularVelocity += 0.8;
      } else if (body.x + extent > bounds.right) {
        body.x = bounds.right - extent;
        body.vx = -abs(body.vx) * 0.42;
        body.angularVelocity -= 0.8;
      }

      if (body.y - extent < bounds.top) {
        body.y = bounds.top + extent;
        body.vy = max(0, body.vy);
      } else if (body.y + extent > bounds.bottom) {
        body.y = bounds.bottom - extent;
        body.vy = 0;
        body.vx *= 0.9;
        body.angularVelocity *= 0.7;
      }

      body.angularVelocity = constrain(body.angularVelocity, -10, 10);
    });

    resolveFallCollisions(grid.cell * 0.46, collisionPadding);
    fallBodies.forEach(body => {
      const angle = radians(body.rotation);
      const extent = grid.cell * 0.5 * (abs(cos(angle)) + abs(sin(angle))) + collisionPadding;
      body.x = constrain(body.x, body.bounds.left + extent, body.bounds.right - extent);
      body.y = constrain(body.y, body.bounds.top + extent, body.bounds.bottom - extent);
    });
  }

  return fallBodies.map(body => ({
    ...canvasPointToLogo({ x: body.x, y: body.y }, body.rotation, grid),
    variant: body.variant,
    glyphIndex: body.glyphIndex
  }));
}

function resolveFallCollisions(radius, padding) {
  for (let firstIndex = 0; firstIndex < fallBodies.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < fallBodies.length; secondIndex++) {
      const first = fallBodies[firstIndex];
      const second = fallBodies[secondIndex];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = max(0.001, sqrt(dx * dx + dy * dy));
      const overlap = radius * 2 + padding - distance;
      if (overlap <= 0) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      first.x -= nx * overlap * 0.5;
      first.y -= ny * overlap * 0.5;
      second.x += nx * overlap * 0.5;
      second.y += ny * overlap * 0.5;

      const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      if (relativeVelocity >= 0) continue;

      const impulse = -relativeVelocity * 0.5;
      first.vx -= nx * impulse;
      first.vy = max(0, first.vy - ny * impulse);
      second.vx += nx * impulse;
      second.vy = max(0, second.vy + ny * impulse);
      const spin = nx * impulse * 0.018;
      first.angularVelocity = constrain(first.angularVelocity - spin, -10, 10);
      second.angularVelocity = constrain(second.angularVelocity + spin, -10, 10);
    }
  }
}

function applyLogoPreset() {
  const layout = state.logoLayout || 'horizontal';
  const amount = layout === 'single' ? 1 : 2;
  const grid = gridMetrics(state.gridSize);
  const centerCol = floor(grid.cols / 2);
  const centerRow = floor(grid.rows / 2);

  state.mode = 'logo';
  state.logoLayout = layout;
  state.logos = amount === 1
    ? [{ col: centerCol, row: centerRow, rotation: cellRotation(centerCol, centerRow) }]
    : layout === 'vertical'
      ? [
          { col: centerCol, row: centerRow - 1, rotation: cellRotation(centerCol, centerRow - 1) },
          { col: centerCol, row: centerRow, rotation: cellRotation(centerCol, centerRow) }
        ]
      : [
          { col: centerCol - 1, row: centerRow, rotation: cellRotation(centerCol - 1, centerRow) },
          { col: centerCol, row: centerRow, rotation: cellRotation(centerCol, centerRow) }
        ];

  selectedLogo = 0;
  moves = {};
  if (state.logoVariant === 'vary') applyNoiseStyles();
  if (isFalling(state)) resetFallBodies();
  showStatus('Logo-opstelling toegepast');
}

function patternCells(pattern, grid) {
  const cells = [];
  const centerCol = floor(grid.cols / 2);
  const centerRow = floor(grid.rows / 2);
  const lastCol = grid.cols - 1;
  const lastRow = grid.rows - 1;

  if (pattern === 'empty') return cells;

  if (pattern === 'line' || pattern === 'lines') {
    const rows = pattern === 'line'
      ? [centerRow]
      : Array.from({ length: grid.rows }, (_, row) => row)
        .filter(row => (row - centerRow) % 2 === 0);
    rows.forEach(row => {
      for (let col = 0; col <= lastCol; col++) {
        cells.push({ col, row });
      }
    });
    return cells;
  }

  if (pattern === 'cross') {
    for (let col = 0; col <= lastCol; col++) {
      cells.push({ col, row: centerRow });
    }
    for (let row = 0; row <= lastRow; row++) {
      if (row !== centerRow) cells.push({ col: centerCol, row });
    }
    return cells;
  }

  if (pattern === 'diagonal') {
    const length = min(grid.cols, grid.rows);
    const colOffset = floor((grid.cols - length) / 2);
    const rowOffset = floor((grid.rows - length) / 2);
    for (let position = 0; position < length; position++) {
      const col = colOffset + position;
      const row = rowOffset + position;
      cells.push({ col, row });
      const mirror = colOffset + length - 1 - position;
      if (mirror !== col) {
        cells.push({ col: mirror, row });
      }
    }
    return cells;
  }

  if (pattern === 'ring') {
    const maxRadius = max(centerCol, centerRow);
    for (let radius = 1; radius <= maxRadius; radius += 2) {
      for (let row = max(0, centerRow - radius); row <= min(lastRow, centerRow + radius); row++) {
        for (let col = max(0, centerCol - radius); col <= min(lastCol, centerCol + radius); col++) {
          if (max(abs(col - centerCol), abs(row - centerRow)) === radius) {
            cells.push({ col, row });
          }
        }
      }
    }
    return cells;
  }

  for (let row = 0; row <= lastRow; row++) {
    for (let col = 0; col <= lastCol; col++) {
      if ((row + col) % 2 === 0) {
        cells.push({ col, row });
      }
    }
  }

  return cells;
}

function connectColors(containerId, property) {
  const container = document.getElementById(containerId);

  container.querySelectorAll('.swatch').forEach(button => {
    button.addEventListener('click', () => {
      state[property] = button.dataset.color;
      setActiveColor(container, button.dataset.color);
      autoUpdateKeyframe();
    });
  });
}

function setActiveColor(container, colorValue) {
  container.querySelectorAll('.swatch').forEach(button => {
    button.classList.toggle('active', button.dataset.color === colorValue);
  });
}

function cloneState(source = state) {
  return {
    ...source,
    mode: source.mode === 'fall' ? 'logo' : source.mode,
    fall: isFalling(source),
    preFallLogos: source.preFallLogos?.map(logo => ({ ...logo })),
    logos: source.logos.map(logo => ({ ...logo }))
  };
}

function addKeyframe() {
  const snapshot = cloneState();
  const currentKeyframe = keyframes[selectedKeyframe];

  if (isFalling(state) && currentKeyframe && isFalling(currentKeyframe)) {
    snapshot.logos = currentKeyframe.logos.map(logo => ({ ...logo }));
  }

  keyframes.push({ ...snapshot, ...timingFromControls() });
  selectedKeyframe = keyframes.length - 1;
  refreshKeyframeList();
  showStatus('Keyframe toegevoegd');
}

function autoUpdateKeyframe({ preserveFallLayout = true } = {}) {
  if (!keyframes[selectedKeyframe]) return;
  const previous = keyframes[selectedKeyframe];
  const snapshot = cloneState();

  if (preserveFallLayout && isFalling(state) && isFalling(previous)) {
    snapshot.logos = previous.logos.map(logo => ({ ...logo }));
  }

  keyframes[selectedKeyframe] = {
    ...snapshot,
    ...timingFromControls()
  };
  refreshKeyframeList();
}

function timingFromControls() {
  const duration = max(
    100,
    Number(document.getElementById('duration').value) || DEFAULT_KEYFRAME_DURATION
  );
  const animationDuration = constrain(
    Number(document.getElementById('animation-duration').value) || DEFAULT_ANIMATION_DURATION,
    100,
    duration
  );

  return {
    duration,
    animationDuration,
    easing: document.getElementById('easing').value || easingType,
    stagger: Number(document.getElementById('stagger').value) || 0
  };
}

function removeKeyframe() {
  if (keyframes.length <= 1) return;
  keyframes.splice(selectedKeyframe, 1);
  selectedKeyframe = min(selectedKeyframe, keyframes.length - 1);
  refreshKeyframeList();
  loadKeyframe();
  showStatus('Keyframe verwijderd');
}

function refreshKeyframeList() {
  const list = document.getElementById('keyframe-list');
  list.innerHTML = '';

  keyframes.forEach((keyframe, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = `Keyframe ${index + 1} · ${modeLabel(keyframe.mode)}${isFalling(keyframe) ? ' · Val' : ''} · ${keyframeDuration(index)} ms`;
    option.selected = index === selectedKeyframe;
    list.appendChild(option);
  });
}

function modeLabel(mode) {
  return {
    pattern: 'Patroon',
    noise: 'Noise',
    logo: 'Logo',
    fall: 'Val'
  }[mode] || 'Patroon';
}

function loadKeyframe() {
  selectedKeyframe = Number(document.getElementById('keyframe-list').value || selectedKeyframe);
  if (!keyframes[selectedKeyframe]) return;
  state = cloneState(keyframes[selectedKeyframe]);
  fallResume = null;
  liveFallReturn = null;
  lastPlaybackFallState = null;
  fallReturnTransition = null;
  moves = {};
  fallBodies = [];
  playbackFallActive = false;
  playbackNoiseRuntime = null;
  playbackNoiseSources = {};
  syncControls();
}

function syncControls() {
  document.getElementById('mode').value = state.mode || 'pattern';
  syncOptionButtons();
  syncZoomControl();
  document.getElementById('show-grid').checked = state.showGrid;
  document.getElementById('focus-logo').checked = Boolean(state.focusOnLogo);
  document.getElementById('logo-variant').value = state.logoVariant || 'original';
  document.getElementById('logo-text').value = state.logoText || 'NOORDZUID';
  document.getElementById('fall').checked = isFalling(state);
  document.getElementById('duration').value = keyframeDuration(selectedKeyframe);
  document.getElementById('animation-duration').value = keyframeAnimationDuration(selectedKeyframe);
  easingType = keyframes[selectedKeyframe]?.easing || easingType;
  stagger = Number(keyframes[selectedKeyframe]?.stagger ?? stagger);
  document.getElementById('easing').value = easingType;
  document.getElementById('stagger').value = stagger;
  updateModeControls();
  refreshKeyframeList();
  setActiveColor(document.getElementById('foreground-colors'), state.foreground);
  setActiveColor(document.getElementById('background-colors'), state.background);
}

function togglePlayback() {
  if (playing) return stopPlayback();
  if (!keyframes.length) return;

  liveFallReturn = null;
  lastPlaybackFallState = null;
  fallReturnTransition = null;
  playbackFallActive = false;

  moves = {};
  playbackNoiseRuntime = null;
  playbackNoiseSources = {};
  playing = true;
  animationStart = millis();
  document.getElementById('play').textContent = 'Stop';
}

function stopPlayback() {
  playing = false;
  liveFallReturn = null;
  lastPlaybackFallState = null;
  fallReturnTransition = null;
  fallBodies = [];
  playbackFallActive = false;
  playbackNoiseRuntime = null;
  playbackNoiseSources = {};
  document.getElementById('play').textContent = 'Play';
}

function keyframeDuration(index) {
  return max(100, Number(keyframes[index]?.duration) || DEFAULT_KEYFRAME_DURATION);
}

function keyframeAnimationDuration(index) {
  return constrain(
    Number(keyframes[index]?.animationDuration) || DEFAULT_ANIMATION_DURATION,
    100,
    keyframeDuration(index)
  );
}

function animationDuration() {
  return keyframes
    .reduce((total, keyframe, index) => total + keyframeDuration(index), 0);
}

function transitionPlan(index, source = keyframes[index]) {
  const from = source;
  const to = keyframes[index + 1];
  const frameLength = keyframeDuration(index + 1);
  const animationLength = keyframeAnimationDuration(index + 1);
  const transitionStagger = constrain(Number(to.stagger ?? stagger), 0, 1);
  const fromGrid = gridMetrics(from.gridSize);
  const toGrid = gridMetrics(to.gridSize);
  const transitionGrid = {
    cols: max(fromGrid.cols, toGrid.cols),
    rows: max(fromGrid.rows, toGrid.rows)
  };
  const positions = from.logos.map(logo => ({ ...logo }));
  const pairCandidates = [];
  const usedSources = new Set();
  const usedTargets = new Set();

  from.logos.forEach((source, sourceIndex) => {
    to.logos.forEach((target, targetIndex) => {
      pairCandidates.push({
        sourceIndex,
        targetIndex,
        distance: abs(source.col - target.col) + abs(source.row - target.row)
      });
    });
  });

  pairCandidates.sort((a, b) => a.distance - b.distance);
  const remaining = [];

  pairCandidates.forEach(pair => {
    if (
      usedSources.has(pair.sourceIndex) ||
      usedTargets.has(pair.targetIndex)
    ) return;

    usedSources.add(pair.sourceIndex);
    usedTargets.add(pair.targetIndex);
    remaining.push(pair);
  });

  const items = [];
  const reservedCells = [];

  while (remaining.length) {
    let planned = false;

    for (let remainingIndex = 0; remainingIndex < remaining.length; remainingIndex++) {
      const pair = remaining[remainingIndex];
      const logoIndex = pair.sourceIndex;
      const target = to.logos[pair.targetIndex];
      const blocked = positions
        .filter((logo, positionIndex) => logo && positionIndex !== logoIndex)
        .concat(reservedCells);
      const path = buildRollPath(
        positions[logoIndex],
        target.col,
        target.row,
        transitionGrid,
        blocked,
        from.gridPhase || 0
      );

      if (!path.length) continue;
      items.push({
        logoIndex,
        targetIndex: pair.targetIndex,
        path,
        weight: pathWeight(path)
      });
      reservedCells.push(...path);
      positions[logoIndex] = { ...target };
      remaining.splice(remainingIndex, 1);
      planned = true;
      break;
    }

    // Pairs without a collision-free route use separate exit and enter rolls.
    if (!planned) break;
  }

  const plannedSources = new Set(items.map(item => item.logoIndex));
  const plannedTargets = new Set(items.map(item => item.targetIndex));

  from.logos.forEach((logo, logoIndex) => {
    if (plannedSources.has(logoIndex)) return;
    const path = exitRollPath(logo, transitionGrid, from.gridPhase || 0);
    items.push({
      kind: 'exit',
      logoIndex,
      path,
      weight: pathWeight(path)
    });
  });

  const enteringTargets = to.logos
    .map((logo, targetIndex) => ({ logo, targetIndex }))
    .filter(item => !plannedTargets.has(item.targetIndex))
    .sort((a, b) => entryDepth(b.logo, transitionGrid) - entryDepth(a.logo, transitionGrid));
  const parkedTargets = [...plannedTargets].map(targetIndex => to.logos[targetIndex]);

  enteringTargets.forEach(({ logo, targetIndex }) => {
    const path = safeEnterRollPath(logo, transitionGrid, parkedTargets);
    items.push({
      kind: 'enter',
      targetIndex,
      path,
      weight: pathWeight(path)
    });
    parkedTargets.push(logo);
  });

  scheduleRollRoutes(items, transitionGrid, animationLength, transitionStagger);

  return { items, duration: frameLength, animationDuration: animationLength };
}

function entryDepth(logo, grid) {
  return min(logo.col + 1, grid.cols - logo.col, logo.row + 1, grid.rows - logo.row);
}

function safeEnterRollPath(logo, grid, parked) {
  const direct = enterRollPath(logo, grid);
  const blocked = new Set(parked.map(point => `${point.col},${point.row}`));
  if (!direct.some(point => blocked.has(`${point.col},${point.row}`))) return direct;

  // A previously landed logo is an obstacle, not a route to roll through.
  const edges = [];
  for (let col = 0; col < grid.cols; col++) {
    edges.push({ col, row: 0, outside: { col, row: -1 } });
    edges.push({ col, row: grid.rows - 1, outside: { col, row: grid.rows } });
  }
  for (let row = 0; row < grid.rows; row++) {
    edges.push({ col: 0, row, outside: { col: -1, row } });
    edges.push({ col: grid.cols - 1, row, outside: { col: grid.cols, row } });
  }
  edges.sort((a, b) => (
    abs(a.col - logo.col) + abs(a.row - logo.row) -
    abs(b.col - logo.col) - abs(b.row - logo.row)
  ));

  for (const edge of edges) {
    if (blocked.has(`${edge.col},${edge.row}`)) continue;
    const inside = buildRollPath({ col: edge.col, row: edge.row, rotation: 0 }, logo.col, logo.row, grid, parked);
    if (!inside.length) continue;
    const path = [{ ...edge.outside, rotation: 0 }, ...inside];
    path[path.length - 1].rotation = logo.rotation;
    for (let i = path.length - 2; i >= 0; i--) {
      path[i].rotation = path[i + 1].rotation - anchoredTurn(path[i], path[i + 1]);
    }
    return path;
  }
  return direct;
}

function scheduleRollRoutes(items, grid, animationLength, transitionStagger) {
  const reservations = new Map();
  const inside = point => point.col >= 0 && point.col < grid.cols && point.row >= 0 && point.row < grid.rows;
  const ordered = items.filter(item => item.weight > 0).sort((a, b) => {
    const priority = item => item.kind === 'exit' ? 0 : item.kind === 'enter' ? 2 : 1;
    return priority(a) - priority(b);
  });
  let lastFinish = 1;

  ordered.forEach((item, index) => {
    let start = index * transitionStagger * 0.5;
    // Reserve both cells swept by a quarter-turn, with a small clearance.
    // Independent routes never wait; shared routes get only the needed delay.
    let changed = true;
    while (changed) {
      changed = false;
      for (let step = 0; step < item.path.length - 1; step++) {
        for (const point of [item.path[step], item.path[step + 1]]) {
          if (!inside(point)) continue;
          const intervals = reservations.get(`${point.col},${point.row}`) || [];
          for (const interval of intervals) {
            if (start + step < interval.end - 0.000001 && start + step + 1.12 > interval.start + 0.000001) {
              start = interval.end - step;
              changed = true;
            }
          }
        }
      }
    }

    item.start = start;
    item.duration = item.weight;
    lastFinish = max(lastFinish, start + item.weight);
    for (let step = 0; step < item.path.length - 1; step++) {
      for (const point of [item.path[step], item.path[step + 1]]) {
        if (!inside(point)) continue;
        const key = `${point.col},${point.row}`;
        if (!reservations.has(key)) reservations.set(key, []);
        reservations.get(key).push({ start: start + step, end: start + step + 1.12 });
      }
    }
  });

  const cellDuration = animationLength / lastFinish;
  items.forEach(item => {
    item.start = (item.start || 0) * cellDuration;
    item.duration = item.weight * cellDuration;
  });
}

function exitRollPath(logo, grid, phase = state.gridPhase || 0) {
  const direction = outwardDirection(logo, grid);
  const path = [{ ...logo }];
  let current = { ...logo };

  while (
    current.col >= 0 && current.col < grid.cols &&
    current.row >= 0 && current.row < grid.rows
  ) {
    const target = {
      col: current.col + direction.col,
      row: current.row + direction.row
    };
    target.rotation = current.rotation + anchoredTurn(current, target);
    path.push(target);
    current = target;
  }

  return path;
}

function enterRollPath(logo, grid, phase = state.gridPhase || 0) {
  const path = exitRollPath(logo, grid, phase)
    .map(point => ({ col: point.col, row: point.row, rotation: 0 }))
    .reverse();

  path[path.length - 1].rotation = logo.rotation;

  for (let index = path.length - 2; index >= 0; index--) {
    path[index].rotation = path[index + 1].rotation - anchoredTurn(path[index], path[index + 1]);
  }

  return path;
}

function outwardDirection(logo, grid) {
  const horizontalDistance = logo.col - (grid.cols - 1) / 2;
  const verticalDistance = logo.row - (grid.rows - 1) / 2;

  if (abs(horizontalDistance) >= abs(verticalDistance) && horizontalDistance !== 0) {
    return { col: Math.sign(horizontalDistance), row: 0 };
  }

  if (verticalDistance !== 0) {
    return { col: 0, row: Math.sign(verticalDistance) };
  }

  const quarter = ((round(logo.rotation / 90) % 4) + 4) % 4;
  return [
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
    { col: 0, row: -1 }
  ][quarter];
}

// Recovery paths use screen positions: fallen bodies are no longer on a cell,
// and changing zoom or focus must not snap them back onto the saved grid first.
function fallReturnItems(source, target) {
  const fromGrid = viewGridMetrics(source);
  const toGrid = viewGridMetrics(target);
  const available = source.logos.map(logo => ({
    logo, point: cellCenter(logo.col, logo.row, fromGrid)
  }));
  const pairs = target.logos.map(logo => {
    const end = cellCenter(logo.col, logo.row, toGrid);
    let nearest = -1;
    let distance = Infinity;
    available.forEach((item, index) => {
      const d = Math.hypot(item.point.x - end.x, item.point.y - end.y);
      if (d < distance) { distance = d; nearest = index; }
    });
    const start = nearest >= 0 ? available.splice(nearest, 1)[0] : {
      logo: { ...logo, rotation: logo.rotation - 90 },
      point: { x: end.x, y: height + toGrid.cell }
    };
    return { start, end, logo };
  });
  available.forEach(start => pairs.push({
    start, end: { x: start.point.x, y: height + fromGrid.cell * 2 },
    logo: { ...start.logo, rotation: start.logo.rotation + 90 }, exit: true
  }));
  return pairs.map(pair => {
    const path = [{ ...pair.start.point, rotation: pair.start.logo.rotation }];
    // Orthogonal, cell-sized rolls, with an exact fractional final step.
    ['x', 'y'].forEach(axis => {
      while (Math.abs(pair.end[axis] - path[path.length - 1][axis]) > 0.001) {
        const previous = path[path.length - 1];
        const delta = Math.sign(pair.end[axis] - previous[axis]) *
          Math.min(toGrid.pitch, Math.abs(pair.end[axis] - previous[axis]));
        path.push({ ...previous, [axis]: previous[axis] + delta,
          rotation: previous.rotation + Math.sign(delta) * 90 });
      }
    });
    const finalRotation = path[path.length - 1].rotation;
    const correction = ((pair.logo.rotation - finalRotation + 540) % 360) - 180;
    return { ...pair, path, correction };
  });
}

function fallReturnState(transition, target, elapsed, duration) {
  const raw = constrain(elapsed / max(1, duration), 0, 1);
  if (raw >= 1) return cloneState(target);
  const source = transition.source;
  const easing = target.easing || easingType;
  const progress = constrain(applyEasing(raw, easing), 0, 1);
  const result = {
    ...cloneState(target), fall: false, noiseRunning: false,
    gridSize: lerp(source.gridSize, target.gridSize, progress),
    foreground: lerpColor(color(source.foreground), color(target.foreground), progress).toString('#rrggbb'),
    background: lerpColor(color(source.background), color(target.background), progress).toString('#rrggbb'),
    viewFocus: 0, viewOffset: { x: 0, y: 0 }
  };
  const grid = gridMetrics(result.gridSize);
  result.gridOrigin = { left: grid.left, top: grid.top };
  result.logos = transition.items.map(item => {
    const count = item.path.length - 1;
    const position = progress * count;
    const index = min(max(0, count - 1), floor(position));
    const from = item.path[index];
    const to = item.path[min(index + 1, count)];
    const local = count ? applyEasing(position - index, easing) : 0;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const pivot = dx !== 0
      ? { x: from.x + dx / 2, y: from.y + abs(dx) / 2 }
      : { x: from.x - abs(dy) / 2, y: from.y + dy / 2 };
    const center = count ? rotatePoint(from, pivot, radians((to.rotation - from.rotation) * local)) : from;
    const rotation = lerp(from.rotation, to.rotation, local) + item.correction * progress;
    return {
      ...item.logo,
      ...canvasPointToLogo(center, rotation, grid),
      variant: raw < 0.5 ? item.start.logo.variant : item.logo.variant
    };
  });
  return result;
}

function playbackState(elapsed) {
  if (keyframes.length < 2) return cloneState(keyframes[0] || state);

  const safeElapsed = max(0, elapsed);
  if (safeElapsed < keyframeDuration(0)) return cloneState(keyframes[0]);
  let segment = 0;
  let segmentStart = keyframeDuration(0);

  while (
    segment < keyframes.length - 2 &&
    safeElapsed >= segmentStart + keyframeDuration(segment + 1)
  ) {
    segmentStart += keyframeDuration(segment + 1);
    segment++;
  }

  const storedFrom = keyframes[segment];
  const to = keyframes[segment + 1];

  // A fall interrupts noise at its actual visible roll pose, including its
  // intermediate rotation/style. This also applies when both frames use noise
  // and only the fall checkbox changes. Ordinary exits still use settled cells.
  if (storedFrom.mode === 'noise' && !isFalling(storedFrom) &&
      (to.mode !== 'noise' || isFalling(to)) && !playbackNoiseSources[segment]) {
    const liveSource = isFalling(to)
      ? playbackNoiseRuntime?.visibleState || playbackNoiseRuntime?.state
      : playbackNoiseRuntime?.state;
    playbackNoiseSources[segment] = {
      ...cloneState(liveSource || storedFrom),
      gridSize: liveSource?.gridSize || storedFrom.gridSize,
      logos: (liveSource?.logos || storedFrom.logos).map(logo => ({ ...logo }))
    };
  }
  const from = playbackNoiseSources[segment] || storedFrom;
  // Physics and recovery have their own motion, not a grid route. In-flight
  // noise poses have fractional cells: running grid BFS on them is expensive
  // and cannot reach integer destinations anyway.
  const plan = isFalling(from) || isFalling(to)
    ? { items: [], animationDuration: keyframeAnimationDuration(segment + 1) }
    : transitionPlan(segment, from);
  const segmentElapsed = elapsed - segmentStart;
  const raw = constrain(segmentElapsed / plan.animationDuration, 0, 1);
  const transitionEasing = to.easing || easingType;
  const eased = applyEasing(raw, transitionEasing);
  const colorProgress = constrain(eased, 0, 1);

  // Freeze the actual fallen pose once and roll it back into the next layout.
  if (isFalling(from) && !isFalling(to)) {
    if (!fallReturnTransition || fallReturnTransition.segment !== segment) {
      const fallen = cloneState(lastPlaybackFallState || from);
      fallReturnTransition = { segment, source: fallen, items: fallReturnItems(fallen, to) };
    }
    return fallReturnState(fallReturnTransition, to, segmentElapsed, plan.animationDuration);
  }

  // Enter physics immediately and use the source keyframe's untouched grid
  // positions. Previously the mode switched halfway through the normal grid
  // transition, which made the fall start mid-roll and reset at that switch.
  if (isFalling(to) && !isFalling(from)) {
    const fallState = cloneState(raw >= 1 ? to : from);
    Object.assign(fallState, transitionViewport(from, to, colorProgress));
    fallState.fall = true;
    fallState.focusOnLogo = raw < 0.5
      ? Boolean(from.focusOnLogo)
      : Boolean(to.focusOnLogo);
    fallState.viewFocus = lerp(
      from.focusOnLogo ? 1 : 0,
      to.focusOnLogo ? 1 : 0,
      colorProgress
    );
    fallState.gridSize = lerp(from.gridSize, to.gridSize, colorProgress);
    fallState.showGrid = raw < 0.5 ? from.showGrid : to.showGrid;
    fallState.foreground = lerpColor(
      color(from.foreground),
      color(to.foreground),
      colorProgress
    ).toString('#rrggbb');
    fallState.background = lerpColor(
      color(from.background),
      color(to.background),
      colorProgress
    ).toString('#rrggbb');
    fallState.logos = from.logos.map(logo => ({ ...logo }));
    return fallState;
  }

  const logos = from.logos.map(logo => ({ ...logo }));
  const enteringLogos = [];
  const sourceFocusLogos = [];
  const targetFocusLogos = [];

  // Ease one shared transition clock, preserving route delays and stagger.
  // Individual cell rolls retain their own easing as well.
  const transitionElapsed = colorProgress * plan.animationDuration;
  plan.items.forEach(item => {
    const progress = item.duration > 0
      ? constrain((transitionElapsed - item.start) / item.duration, 0, 1)
      : 1;
    const poseSource = item.kind === 'enter'
      ? to.logos[item.targetIndex]
      : from.logos[item.logoIndex];
    const pose = {
      ...poseSource,
      ...rollPathPose(item.path, progress, from.gridSize, transitionEasing)
    };

    if ((from.logoVariant === 'vary' || to.logoVariant === 'vary') && item.weight > 0) {
      const sourceLogo = from.logos[item.logoIndex];
      const targetLogo = to.logos[item.targetIndex];
      const sourceVariant = sourceLogo?.variant || (sourceLogo ? noiseVariantFor(sourceLogo.col, sourceLogo.row, 0, item.logoIndex) : 'original');
      const targetVariant = targetLogo?.variant || (targetLogo ? noiseVariantFor(targetLogo.col, targetLogo.row, 1, item.targetIndex) : sourceVariant);
      pose.variant = raw < 0.5
        ? (sourceVariant || targetVariant || 'original')
        : (targetVariant || sourceVariant || 'original');
    }

    if (item.kind === 'enter') {
      const enteringLogo = {
        ...pose,
        glyphIndex: item.targetIndex
      };
      enteringLogos.push(enteringLogo);
      targetFocusLogos.push(enteringLogo);
      return;
    }

    if (item.kind === 'exit') {
      const exitingLogo = { ...pose };
      logos[item.logoIndex] = exitingLogo;
      sourceFocusLogos.push(exitingLogo);
      return;
    }

    const target = to.logos[item.targetIndex];
    logos[item.logoIndex] = progress >= 1 ? { ...target } : pose;
    sourceFocusLogos.push(logos[item.logoIndex]);
    targetFocusLogos.push(logos[item.logoIndex]);
  });

  if (raw >= 1) return cloneState(to);

  logos.push(...enteringLogos);

  const focusLogos = to.focusOnLogo && to.mode === 'logo'
    ? targetFocusLogos
    : from.focusOnLogo && from.mode === 'logo'
      ? sourceFocusLogos
      : [logos[constrain(selectedLogo, 0, max(0, logos.length - 1))]].filter(Boolean);

  return {
    ...transitionViewport(from, to, colorProgress),
    fall: isFalling(from) && isFalling(to),
    animationDuration: plan.animationDuration,
    easing: transitionEasing,
    // Never start a procedural field with interpolated, mid-roll positions.
    // Finish the incoming keyframe roll first; suspend noise during an exit.
    noiseRunning: from.mode === 'noise' && to.mode === 'noise',
    noiseSeed: from.mode === 'noise' && to.mode === 'noise' ? from : undefined,
    mode: raw < 0.5 ? (from.mode || 'pattern') : (to.mode || 'pattern'),
    pattern: raw < 0.5 ? (from.pattern || 'alternating') : (to.pattern || 'alternating'),
    focusOnLogo: raw < 0.5 ? Boolean(from.focusOnLogo) : Boolean(to.focusOnLogo),
    viewFocus: lerp(from.focusOnLogo ? 1 : 0, to.focusOnLogo ? 1 : 0, colorProgress),
    gridSize: lerp(from.gridSize, to.gridSize, colorProgress),
    gridPhase: raw < 0.5 ? (from.gridPhase || 0) : (to.gridPhase || 0),
    showGrid: raw < 0.5 ? from.showGrid : to.showGrid,
    logoLayout: raw < 0.5
      ? (from.logoLayout || 'horizontal')
      : (to.logoLayout || 'horizontal'),
    logoVariant: raw < 0.5
      ? (from.logoVariant || 'original')
      : (to.logoVariant || 'original'),
    logoText: raw < 0.5
      ? (from.logoText || 'NOORDZUID')
      : (to.logoText || 'NOORDZUID'),
    noiseMotion: raw < 0.5
      ? (from.noiseMotion || 'playful')
      : (to.noiseMotion || 'playful'),
    noiseDensity: raw < 0.5
      ? (from.noiseDensity || 'balanced')
      : (to.noiseDensity || 'balanced'),
    foreground: lerpColor(color(from.foreground), color(to.foreground), colorProgress).toString('#rrggbb'),
    background: lerpColor(color(from.background), color(to.background), colorProgress).toString('#rrggbb'),
    focusLogos,
    logos
  };
}

function applyEasing(amount, type = easingType) {
  const t = constrain(amount, 0, 1);
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  const c3 = c1 + 1;
  const c4 = (2 * Math.PI) / 3;
  const c5 = (2 * Math.PI) / 4.5;

  switch (type) {
    case 'linear': return t;
    case 'easeInQuad': return t * t;
    case 'easeOutQuad': return 1 - (1 - t) * (1 - t);
    case 'easeInOutQuad': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'easeInCubic': return t * t * t;
    case 'easeOutCubic': return 1 - Math.pow(1 - t, 3);
    case 'easeInOutCubic': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'easeInQuart': return t * t * t * t;
    case 'easeOutQuart': return 1 - Math.pow(1 - t, 4);
    case 'easeInOutQuart': return t < 0.5 ? 8 * Math.pow(t, 4) : 1 - Math.pow(-2 * t + 2, 4) / 2;
    case 'easeInQuint': return Math.pow(t, 5);
    case 'easeOutQuint': return 1 - Math.pow(1 - t, 5);
    case 'easeInOutQuint': return t < 0.5 ? 16 * Math.pow(t, 5) : 1 - Math.pow(-2 * t + 2, 5) / 2;
    case 'easeInSine': return 1 - Math.cos(t * Math.PI / 2);
    case 'easeOutSine': return Math.sin(t * Math.PI / 2);
    case 'easeInOutSine': return -(Math.cos(Math.PI * t) - 1) / 2;
    case 'easeInExpo': return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
    case 'easeOutExpo': return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'easeInOutExpo':
      if (t === 0 || t === 1) return t;
      return t < 0.5
        ? Math.pow(2, 20 * t - 10) / 2
        : (2 - Math.pow(2, -20 * t + 10)) / 2;
    case 'easeInCirc': return 1 - Math.sqrt(1 - t * t);
    case 'easeOutCirc': return Math.sqrt(1 - Math.pow(t - 1, 2));
    case 'easeInOutCirc':
      return t < 0.5
        ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2
        : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;
    case 'easeInBack': return c3 * t * t * t - c1 * t * t;
    case 'easeOutBack': return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    case 'easeInOutBack':
      return t < 0.5
        ? Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    case 'easeInBounce': return 1 - bounceOut(1 - t);
    case 'easeOutBounce': return bounceOut(t);
    case 'easeInOutBounce':
      return t < 0.5
        ? (1 - bounceOut(1 - 2 * t)) / 2
        : (1 + bounceOut(2 * t - 1)) / 2;
    case 'easeInElastic':
      if (t === 0 || t === 1) return t;
      return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
    case 'easeOutElastic':
      if (t === 0 || t === 1) return t;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    case 'easeInOutElastic':
      if (t === 0 || t === 1) return t;
      return t < 0.5
        ? -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2
        : Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5) / 2 + 1;
    case 'steps4': return t === 1 ? 1 : Math.floor(t * 4) / 4;
    case 'steps8': return t === 1 ? 1 : Math.floor(t * 8) / 8;
    case 'wiggle': return t + Math.sin(t * Math.PI * 6) * Math.sin(t * Math.PI) * 0.12;
    default: return t;
  }
}

function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

function resizeFromInputs() {
  const newWidth = constrain(Number(document.getElementById('canvas-width').value) || 600, 200, 1920);
  const newHeight = constrain(Number(document.getElementById('canvas-height').value) || 600, 200, 1920);
  if (newWidth === width && newHeight === height) return;
  const scale = min(newWidth / width, newHeight / height);
  // Every frame has its own zoom/layout. Capture each grid before resizing;
  // changing export resolution must never reapply patterns or noise seeds.
  const layouts = [state, ...keyframes].map(source => ({
    source,
    oldGrid: gridMetrics(source.gridSize)
  }));
  stopPlayback();
  resizeCanvas(newWidth, newHeight);
  fitCanvasPreview();
  layouts.forEach(({ source, oldGrid }) => {
    source.gridSize *= scale;
    const newGrid = gridMetrics(source.gridSize);
    const shiftCol = (newGrid.cols - oldGrid.cols) / 2;
    const shiftRow = (newGrid.rows - oldGrid.rows) / 2;
    const reposition = logo => ({
      ...logo, col: logo.col + shiftCol, row: logo.row + shiftRow
    });
    source.gridPhase = (((source.gridPhase || 0) - shiftCol - shiftRow) % 2 + 2) % 2;
    source.logos = source.logos.map(reposition);
    if (source.preFallLogos) source.preFallLogos = source.preFallLogos.map(reposition);
    // These are transient camera coordinates, not part of the saved layout.
    delete source.gridOrigin;
    delete source.viewOffset;
    delete source.viewFocus;
    delete source.focusLogos;
  });
  moves = {};
  fallResume = null;
  nextNoiseMoveAt = millis() + 250;
  clearLogoRenderCache();
  syncControls();
}

function fitCanvasPreview() {
  if (!canvasElement || !canvasContainer) return;

  const bounds = canvasContainer.getBoundingClientRect();
  const availableWidth = bounds.width;
  const availableHeight = bounds.height;

  if (!availableWidth || !availableHeight) return;

  const scale = min(availableWidth / width, availableHeight / height);
  const screenDensity = window.devicePixelRatio || 1;
  const previewDensity = constrain(
    ceil(screenDensity * max(1, scale)),
    1,
    3
  );

  if (pixelDensity() !== previewDensity) {
    pixelDensity(previewDensity);
    clearLogoRenderCache();
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
  saveCanvas('schets', 'png');
  exportingPNG = false;
}

function exportMP4() {
  if (!keyframes.length) return;
  if (!window.MediaRecorder || !canvasElement.captureStream) return showStatus('MP4-export wordt niet ondersteund');

  const mimeType = ['video/mp4;codecs=avc1.42E01E', 'video/mp4']
    .find(type => MediaRecorder.isTypeSupported(type));

  if (!mimeType) return showStatus('MP4-export wordt niet ondersteund in deze browser');

  const stream = canvasElement.captureStream(60);
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10000000 });

  recorder.addEventListener('dataavailable', event => {
    if (event.data.size) chunks.push(event.data);
  });

  recorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'schets.mp4';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    stream.getTracks().forEach(track => track.stop());
    exporting = false;
    playbackNoiseRuntime = null;
    playbackNoiseSources = {};
    showStatus('MP4 geëxporteerd');
  });

  stopPlayback();
  exporting = true;
  animationStart = millis();
  recorder.start();
  showStatus('MP4 wordt gemaakt…');
  setTimeout(() => recorder.stop(), animationDuration() + 100);
}

function showStatus(message) {
  document.getElementById('status').textContent = message;
}
