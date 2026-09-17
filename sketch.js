// Add one SVG here; preload and the interface update automatically.
const LOGO_VARIANTS = [
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
  noiseLogoStyle: false,
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
  updateNoiseMotion();
  updateFallMotion();
  let drawingState = state;

  if (playing || exporting) {
    const elapsed = millis() - animationStart;
    drawingState = playbackState(elapsed);

    if (drawingState.mode === 'fall') {
      drawingState = playbackFallState(drawingState);
    } else {
      playbackFallActive = false;
    }

    if (drawingState.mode === 'noise') {
      drawingState = playbackNoiseState(drawingState);
    } else {
      playbackNoiseRuntime = null;
    }

    if (playing && elapsed >= animationDuration()) {
      const finalState = cloneState(keyframes[keyframes.length - 1]);

      // Keep the final physics pose so stopping playback cannot snap back to
      // the grid positions stored in the fall keyframe.
      if (finalState.mode === 'fall' && drawingState.mode === 'fall') {
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
  return canvasPointToLogo(center, logo.rotation, toGrid);
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

  const logoVariant = drawingState.mode === 'noise' && drawingState.noiseLogoStyle
    ? (logo.variant || 'original')
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
      document.getElementById('logo-amount').value = String(state.logos.length);
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

  if (state.mode === 'fall') {
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
    duration: pathWeight(path) * 360
  };

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
    updateTextControls();
    autoUpdateKeyframe();
  });
  document.getElementById('logo-text').addEventListener('input', event => {
    state.logoText = event.target.value;
    autoUpdateKeyframe();
  });

  modeControl.addEventListener('change', event => {
    setMode(event.target.value);
    autoUpdateKeyframe();
  });

  document.getElementById('grid-size').addEventListener('input', event => {
    const oldGrid = gridMetrics(state.gridSize);
    const newSize = zoomLevels()[Number(event.target.value)];
    const newGrid = gridMetrics(newSize);
    const shiftCol = (newGrid.cols - oldGrid.cols) / 2;
    const shiftRow = (newGrid.rows - oldGrid.rows) / 2;

    state.gridPhase = ((state.gridPhase || 0) - shiftCol - shiftRow) % 2;
    if (state.gridPhase < 0) state.gridPhase += 2;

    if (state.mode === 'fall') {
      state.logos = state.logos.map(logo => remapLogoBetweenGrids(logo, oldGrid, newGrid));
      const currentKeyframe = keyframes[selectedKeyframe];
      if (currentKeyframe?.mode === 'fall') {
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

  document.getElementById('pattern').addEventListener('change', () => {
    applyPattern();
    autoUpdateKeyframe();
  });
  document.getElementById('noise-motion').addEventListener('change', event => {
    state.noiseMotion = event.target.value;
    nextNoiseMoveAt = 0;
    autoUpdateKeyframe();
  });
  document.getElementById('noise-density').addEventListener('change', event => {
    state.noiseDensity = event.target.value;
    applyNoiseField();
    autoUpdateKeyframe();
  });
  document.getElementById('noise-logo-style').addEventListener('change', event => {
    state.noiseLogoStyle = event.target.checked;
    if (state.noiseLogoStyle) applyNoiseStyles();
    autoUpdateKeyframe();
  });
  document.getElementById('logo-amount').addEventListener('change', () => {
    applyLogoPreset();
    autoUpdateKeyframe();
  });
  document.getElementById('logo-layout').addEventListener('change', () => {
    applyLogoPreset();
    autoUpdateKeyframe();
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
  const pattern = document.getElementById('pattern').value;
  state.pattern = pattern;
  const cells = patternCells(pattern, gridMetrics(state.gridSize));

  state.logos = cells.map(cell => ({
    col: cell.col,
    row: cell.row,
    rotation: cellRotation(cell.col, cell.row)
  }));

  selectedLogo = 0;
  moves = {};
  showStatus('Patroon toegepast');
}

function setMode(mode) {
  state.mode = mode;
  moves = {};
  if (mode !== 'fall') {
    fallBodies = [];
    playbackFallActive = false;
  }
  updateModeControls();

  if (mode === 'noise') {
    applyNoiseField();
  } else if (mode === 'logo') {
    applyLogoPreset();
  } else if (mode === 'pattern') {
    applyPattern();
  } else if (mode === 'fall') {
    resetFallBodies();
    playbackFallActive = false;
    showStatus('De logo’s vallen binnen het canvas');
  }
}

function updateModeControls() {
  document.getElementById('mode-settings').hidden = state.mode === 'fall';
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
      ...(state.noiseLogoStyle
        ? { variant: noiseVariantFor(col, row, noiseIteration, index) }
        : {})
    }));
  selectedLogo = 0;
  noiseIteration++;
  moves = {};
  nextNoiseMoveAt = millis() + 250;
  showStatus('Noise veld beweegt automatisch');
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
  if (state.noiseLogoStyle) {
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
  const variants = LOGO_VARIANTS.filter(variant => variant.id !== 'text');
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
  return {
    calm: { duration: 760, pause: 260, amount: 0.24, spread: 0.12 },
    playful: { duration: 480, pause: 100, amount: 0.48, spread: 0.22 },
    wild: { duration: 280, pause: 30, amount: 0.76, spread: 0.38 }
  }[state.noiseMotion || 'playful'];
}

function updateNoiseMotion() {
  if (
    state.mode !== 'noise' || playing || exporting || exportingPNG ||
    millis() < nextNoiseMoveAt || Object.keys(moves).length > 0
  ) return;

  applyNoiseStep();
}

function playbackNoiseState(drawingState) {
  if (!playbackNoiseRuntime) {
    playbackNoiseRuntime = {
      state: cloneState(drawingState),
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

  return {
    ...drawingState,
    logos: visibleLogos
  };
}

function resetFallBodies(sourceState = state) {
  const grid = gridMetrics(sourceState.gridSize);

  fallBodies = sourceState.logos.map((logo, index) => {
    const center = cellCenter(logo.col, logo.row, grid);
    return {
      x: center.x,
      y: center.y,
      vx: sin((index + 1) * 2.17) * 18,
      vy: 0,
      rotation: logo.rotation,
      angularVelocity: sin((index + 1) * 1.37) * 4
    };
  });
  lastFallUpdate = millis();
}

function updateFallMotion() {
  if (state.mode !== 'fall' || playing || exporting || exportingPNG) return;

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

  return {
    ...drawingState,
    logos: stepFallBodies(drawingState)
  };
}

function stepFallBodies(sourceState) {
  if (!fallBodies.length) return [];

  const now = millis();
  const elapsed = constrain((now - lastFallUpdate) / 1000, 0, 0.04);
  lastFallUpdate = now;
  const grid = gridMetrics(sourceState.gridSize);
  const collisionPadding = 3;
  const steps = 4;
  const dt = elapsed / steps;

  for (let step = 0; step < steps; step++) {
    fallBodies.forEach(body => {
      body.vy += 980 * dt;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.rotation += body.angularVelocity * dt;

      const angle = radians(body.rotation);
      const extent = grid.cell * 0.5 * (abs(cos(angle)) + abs(sin(angle))) + collisionPadding;

      if (body.x - extent < 0) {
        body.x = extent;
        body.vx = abs(body.vx) * 0.42;
        body.angularVelocity += 0.8;
      } else if (body.x + extent > width) {
        body.x = width - extent;
        body.vx = -abs(body.vx) * 0.42;
        body.angularVelocity -= 0.8;
      }

      if (body.y - extent < 0) {
        body.y = extent;
        body.vy = max(0, body.vy);
      } else if (body.y + extent > height) {
        body.y = height - extent;
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
      body.x = constrain(body.x, extent, width - extent);
      body.y = constrain(body.y, extent, height - extent);
    });
  }

  return fallBodies.map(body => canvasPointToLogo(
    { x: body.x, y: body.y },
    body.rotation,
    grid
  ));
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
  const amount = Number(document.getElementById('logo-amount').value || 2);
  const layout = document.getElementById('logo-layout').value || 'horizontal';
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
    logos: source.logos.map(logo => ({ ...logo }))
  };
}

function addKeyframe() {
  const snapshot = cloneState();
  const currentKeyframe = keyframes[selectedKeyframe];

  if (state.mode === 'fall' && currentKeyframe?.mode === 'fall') {
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

  if (preserveFallLayout && state.mode === 'fall' && previous.mode === 'fall') {
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
    option.textContent = `Keyframe ${index + 1} · ${modeLabel(keyframe.mode)} · ${keyframeDuration(index)} ms`;
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
  moves = {};
  fallBodies = [];
  playbackFallActive = false;
  syncControls();
}

function syncControls() {
  document.getElementById('mode').value = state.mode || 'pattern';
  document.getElementById('pattern').value = state.pattern || 'alternating';
  syncZoomControl();
  document.getElementById('show-grid').checked = state.showGrid;
  document.getElementById('focus-logo').checked = Boolean(state.focusOnLogo);
  document.getElementById('logo-variant').value = state.logoVariant || 'original';
  document.getElementById('logo-text').value = state.logoText || 'NOORDZUID';
  document.getElementById('logo-layout').value = state.logoLayout || 'horizontal';
  document.getElementById('logo-amount').value = String(constrain(state.logos.length, 1, 2));
  document.getElementById('noise-motion').value = state.noiseMotion || 'playful';
  document.getElementById('noise-density').value = state.noiseDensity || 'balanced';
  document.getElementById('noise-logo-style').checked = Boolean(state.noiseLogoStyle);
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

  moves = {};
  playbackNoiseRuntime = null;
  playing = true;
  animationStart = millis();
  document.getElementById('play').textContent = 'Stop';
}

function stopPlayback() {
  playing = false;
  fallBodies = [];
  playbackFallActive = false;
  playbackNoiseRuntime = null;
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
  if (keyframes.length === 1) return keyframeDuration(0);

  return keyframes
    .slice(0, -1)
    .reduce((total, keyframe, index) => total + keyframeDuration(index), 0);
}

function transitionPlan(index) {
  const from = keyframes[index];
  const to = keyframes[index + 1];
  const frameLength = keyframeDuration(index);
  const animationLength = keyframeAnimationDuration(index);
  const transitionStagger = constrain(Number(from.stagger ?? stagger), 0, 1);
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

  to.logos.forEach((logo, targetIndex) => {
    if (plannedTargets.has(targetIndex)) return;
    const path = enterRollPath(logo, transitionGrid, to.gridPhase || 0);
    items.push({
      kind: 'enter',
      targetIndex,
      path,
      weight: pathWeight(path)
    });
  });

  const movingItems = items.filter(item => item.weight > 0);
  const staggerWindow = movingItems.length > 1 && transitionStagger > 0.001
    ? animationLength * 0.45 * transitionStagger
    : 0;
  const delay = movingItems.length > 1
    ? staggerWindow / (movingItems.length - 1)
    : 0;
  const movementDuration = animationLength - staggerWindow;
  let movingIndex = 0;

  items.forEach(item => {
    if (item.weight === 0) {
      item.start = 0;
      item.duration = 0;
      return;
    }

    item.start = movingIndex * delay;
    item.duration = movementDuration;
    movingIndex++;
  });

  return { items, duration: frameLength, animationDuration: animationLength };
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

function playbackState(elapsed) {
  if (keyframes.length < 2) return cloneState(keyframes[0] || state);

  const safeElapsed = max(0, elapsed);
  let segment = 0;
  let segmentStart = 0;

  while (
    segment < keyframes.length - 2 &&
    safeElapsed >= segmentStart + keyframeDuration(segment)
  ) {
    segmentStart += keyframeDuration(segment);
    segment++;
  }

  const plan = transitionPlan(segment);
  const duration = plan.duration;
  const segmentElapsed = elapsed - segmentStart;
  const from = keyframes[segment];
  const to = keyframes[segment + 1];
  const raw = constrain(segmentElapsed / plan.animationDuration, 0, 1);
  const eased = applyEasing(raw, from.easing || easingType);
  const colorProgress = constrain(eased, 0, 1);

  // Leaving physics is a deliberate hard cut: never rebuild fallen items onto a grid.
  if (from.mode === 'fall' && to.mode !== 'fall') {
    return segmentElapsed < plan.animationDuration
      ? cloneState(from)
      : cloneState(to);
  }

  // Enter physics immediately and use the source keyframe's untouched grid
  // positions. Previously the mode switched halfway through the normal grid
  // transition, which made the fall start mid-roll and reset at that switch.
  if (to.mode === 'fall' && from.mode !== 'fall') {
    const fallState = cloneState(raw >= 1 ? to : from);
    Object.assign(fallState, transitionViewport(from, to, colorProgress));
    fallState.mode = 'fall';
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

  plan.items.forEach(item => {
    const progress = item.duration > 0
      ? constrain((segmentElapsed - item.start) / item.duration, 0, 1)
      : 1;
    const poseSource = item.kind === 'enter'
      ? to.logos[item.targetIndex]
      : from.logos[item.logoIndex];
    const pose = {
      ...poseSource,
      ...rollPathPose(item.path, progress, from.gridSize, from.easing || easingType)
    };

    if (from.noiseLogoStyle || to.noiseLogoStyle) {
      const sourceVariant = from.logos[item.logoIndex]?.variant;
      const targetVariant = to.logos[item.targetIndex]?.variant;
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
    noiseLogoStyle: raw < 0.5
      ? Boolean(from.noiseLogoStyle)
      : Boolean(to.noiseLogoStyle),
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
  const oldGrid = gridMetrics(state.gridSize);
  resizeCanvas(newWidth, newHeight);
  fitCanvasPreview();
  const newGrid = gridMetrics(state.gridSize);
  const shiftCol = (newGrid.cols - oldGrid.cols) / 2;
  const shiftRow = (newGrid.rows - oldGrid.rows) / 2;

  state.gridPhase = ((state.gridPhase || 0) - shiftCol - shiftRow) % 2;
  if (state.gridPhase < 0) state.gridPhase += 2;

  state.logos.forEach(logo => {
    logo.col += shiftCol;
    logo.row += shiftRow;
  });

  moves = {};
  if (state.mode === 'pattern') applyPattern();
  if (state.mode === 'noise') applyNoiseField();
  syncZoomControl();
  autoUpdateKeyframe();
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
