// Add one SVG here; preload and the interface update automatically.
const LOGO_VARIANTS = [
  { id: 'original', label: 'Origineel', path: 'assets/logo.svg' },
  { id: 'squares', label: 'Vierkanten', path: 'assets/logo-squares.svg' },
  { id: 'circles', label: 'Cirkels', path: 'assets/logo-circles.svg' },
  { id: 'long-circles', label: 'Lange cirkels', path: 'assets/logo-longcircles.svg' },
  { id: 'short-circles', label: 'Korte cirkels', path: 'assets/logo-shortcircles.svg' },
  { id: 'lines', label: 'Lijnen', path: 'assets/logo-lines.svg' }
];

let state = {
  gridSize: 64,
  showGrid: false,
  logoVariant: 'original',
  foreground: '#F28EFF',
  background: '#270C13',
  logos: [
    { col: 4, row: 4, rotation: 0 },
    { col: 5, row: 4, rotation: 90 }
  ]
};

let keyframes = [];
let selectedKeyframe = 0;
let selectedLogo = 0;
let transitionLength = 600;
let easingType = 'easeInOutCubic';
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
let dominoLoop = false;
let dominoIteration = 0;
let nextDominoAt = 0;

function preload() {
  LOGO_VARIANTS.forEach(variant => {
    logoImages[variant.id] = loadImage(variant.path);
  });
}

function setup() {
  const canvas = createCanvas(1000, 600);
  canvas.parent('canvas-container');
  canvasElement = canvas.elt;
  canvasContainer = document.getElementById('canvas-container');

  rectMode(CENTER);
  noStroke();

  fitCanvasPreview();
  if (window.ResizeObserver) {
    canvasResizeObserver = new ResizeObserver(fitCanvasPreview);
    canvasResizeObserver.observe(canvasContainer);
  }

  connectControls();
  addKeyframe();
  showStatus('Klik een logo en daarna een gridcel');
}

function draw() {
  let drawingState = state;

  if (playing || exporting) {
    const elapsed = millis() - animationStart;
    drawingState = playbackState(elapsed);

    if (playing && elapsed >= animationDuration()) {
      state = cloneState(keyframes[keyframes.length - 1]);
      stopPlayback();
      syncControls();
    }
  }

  background(drawingState.background);

  const drawingGrid = gridMetrics(drawingState.gridSize);

  if (drawingState.showGrid && !exporting && !exportingPNG) {
    drawGrid(drawingGrid, drawingState.foreground);
  }

  drawingState.logos.forEach((logo, index) => {
    const visibleLogo = playing || exporting ? logo : movingLogo(index, logo);

    if (
      visibleLogo.col < 0 || visibleLogo.col >= drawingGrid.count ||
      visibleLogo.row < 0 || visibleLogo.row >= drawingGrid.count
    ) return;

    drawLogo(visibleLogo, drawingState);

    if (drawingState.showGrid && index === selectedLogo && !exporting && !exportingPNG) {
      drawSelectionIndicator(visibleLogo, drawingState);
    }
  });

  updateDominoLoop();
}

function gridMetrics(gridSize) {
  const viewportSide = min(width, height);
  const cell = gridSize;
  const gap = cell * (10 / 64);
  let count = max(3, ceil((viewportSide + gap) / (cell + gap)));

  // An odd count keeps the grid centred. Rounding up clips cells at the edges.
  if (count % 2 === 0) count++;

  const side = count * cell + (count - 1) * gap;

  return {
    count,
    side,
    gap,
    cell,
    pitch: cell + gap,
    left: (width - side) / 2,
    top: (height - side) / 2
  };
}

function drawGrid(grid, gridColor) {
  const lineColor = color(gridColor);
  lineColor.setAlpha(85);
  stroke(lineColor);
  strokeWeight(1);

  noFill();
  rectMode(CORNER);

  for (let row = 0; row < grid.count; row++) {
    for (let col = 0; col < grid.count; col++) {
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

function drawLogo(logo, drawingState) {
  const grid = gridMetrics(drawingState.gridSize);
  const length = grid.cell;
  const center = cellCenter(logo.col, logo.row, grid);
  const x = center.x;
  const y = center.y;
  const logoImage = renderedLogo(
    drawingState.logoVariant || 'original',
    drawingState.foreground,
    length
  );

  push();
  translate(x, y);
  rotate(radians(logo.rotation));
  imageMode(CENTER);
  image(logoImage, 0, 0, length, length);
  pop();
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
}

function drawSelectionIndicator(logo, drawingState) {
  const grid = gridMetrics(drawingState.gridSize);
  const col = constrain(round(logo.col), 0, grid.count - 1);
  const row = constrain(round(logo.row), 0, grid.count - 1);

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
  const grid = gridMetrics(interactionState.gridSize);

  if (
    canvasX < grid.left ||
    canvasX > grid.left + grid.side ||
    canvasY < grid.top ||
    canvasY > grid.top + grid.side
  ) return;

  const localX = canvasX - grid.left;
  const localY = canvasY - grid.top;
  const col = constrain(floor(localX / grid.pitch), 0, grid.count - 1);
  const row = constrain(floor(localY / grid.pitch), 0, grid.count - 1);

  if (localX - col * grid.pitch > grid.cell || localY - row * grid.pitch > grid.cell) return;
  const clickedLogo = interactionState.logos.findIndex((logo, index) => {
    const visibleLogo = playing ? logo : movingLogo(index, logo);
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

  rollLogo(selectedLogo, col, row);
}

function rollLogo(index, targetCol, targetRow) {
  const from = { ...state.logos[index] };
  const blocked = state.logos.filter((logo, logoIndex) => logoIndex !== index);
  const path = buildRollPath(from, targetCol, targetRow, gridMetrics(state.gridSize).count, blocked);

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
  return rollPathPose(move.path, raw, state.gridSize);
}

function buildRollPath(from, targetCol, targetRow, gridCount, blocked = []) {
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
        next.col < 0 || next.col >= gridCount ||
        next.row < 0 || next.row >= gridCount ||
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
      const previous = cells[index - 1];
      rotation += rollTurn(previous, cell, blocked);
    }

    return { ...cell, rotation };
  });
}

function rollTurn(from, to, otherLogos) {
  const directionX = to.col - from.col;
  const directionY = to.row - from.row;
  const other = nearestLogo(from, otherLogos);

  if (directionX !== 0) {
    let pivotSide = 1;

    if (other && other.row < from.row) pivotSide = -1;
    if (other && other.row > from.row) pivotSide = 1;

    return directionX * pivotSide * 90;
  }

  let pivotSide = -1;

  if (other && other.col < from.col) pivotSide = -1;
  if (other && other.col > from.col) pivotSide = 1;

  return -directionY * pivotSide * 90;
}

function nearestLogo(from, logos) {
  if (!logos.length) return null;

  return logos.reduce((nearest, logo) => {
    const distance = abs(logo.col - from.col) + abs(logo.row - from.row);
    const nearestDistance = abs(nearest.col - from.col) + abs(nearest.row - from.row);
    return distance < nearestDistance ? logo : nearest;
  });
}

function rollPathPose(path, progress, gridSize) {
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
      const easedProgress = constrain(applyEasing(localProgress), 0, 1);
      return rollStepPose(path[i], path[i + 1], easedProgress, grid);
    }

    travelled += weight;
  }

  return { ...to };
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
    const pivotSide = Math.sign(turn / directionX) || 1;
    pivot = {
      x: start.x + directionX * grid.pitch / 2,
      y: start.y + pivotSide * grid.pitch / 2
    };
  } else {
    const pivotSide = Math.sign(-turn / directionY) || -1;
    pivot = {
      x: start.x + pivotSide * grid.pitch / 2,
      y: start.y + directionY * grid.pitch / 2
    };
  }

  const rotation = lerp(from.rotation, to.rotation, progress);
  const center = rotatePoint(
    start,
    pivot,
    radians((to.rotation - from.rotation) * progress)
  );

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

  LOGO_VARIANTS.forEach(variant => {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variant.label;
    logoVariantControl.appendChild(option);
  });

  logoVariantControl.value = state.logoVariant;
  logoVariantControl.addEventListener('change', event => {
    state.logoVariant = event.target.value;
  });

  document.getElementById('grid-size').addEventListener('input', event => {
    const oldCount = gridMetrics(state.gridSize).count;
    const newSize = constrain(Number(event.target.value) || 64, 32, 120);
    const newCount = gridMetrics(newSize).count;
    const shift = (newCount - oldCount) / 2;

    state.logos.forEach(logo => {
      logo.col += shift;
      logo.row += shift;
    });

    state.gridSize = newSize;
    event.target.value = newSize;
    moves = {};
  });

  document.getElementById('show-grid').addEventListener('change', event => {
    state.showGrid = event.target.checked;
  });

  document.getElementById('apply-pattern').addEventListener('click', applyPattern);

  document.getElementById('add-logo').addEventListener('click', addLogo);
  document.getElementById('remove-logo').addEventListener('click', removeLogo);
  document.getElementById('domino').addEventListener('click', () => startDomino(false));
  document.getElementById('domino-loop').addEventListener('change', event => {
    if (event.target.checked && !state.logos.length) {
      event.target.checked = false;
      showStatus('Voeg eerst een logo toe');
      return;
    }

    dominoLoop = event.target.checked;
    nextDominoAt = millis();
    showStatus(dominoLoop ? 'Noise veld aan' : 'Noise veld uit');
  });

  connectColors('foreground-colors', 'foreground');
  connectColors('background-colors', 'background');
  document.getElementById('add-keyframe').addEventListener('click', addKeyframe);
  document.getElementById('remove-keyframe').addEventListener('click', removeKeyframe);
  document.getElementById('update-keyframe').addEventListener('click', updateKeyframe);
  document.getElementById('keyframe-list').addEventListener('change', loadKeyframe);
  document.getElementById('play').addEventListener('click', togglePlayback);
  document.getElementById('easing').addEventListener('change', event => {
    easingType = event.target.value;
  });
  document.getElementById('stagger').addEventListener('input', event => {
    stagger = Number(event.target.value);
  });
  document.getElementById('duration').addEventListener('change', event => {
    transitionLength = max(100, Number(event.target.value) || 800);
  });
  document.getElementById('canvas-width').addEventListener('change', resizeFromInputs);
  document.getElementById('canvas-height').addEventListener('change', resizeFromInputs);
  document.getElementById('export-png').addEventListener('click', exportPNG);
  document.getElementById('export-mp4').addEventListener('click', exportMP4);
}

function applyPattern() {
  const pattern = document.getElementById('pattern').value;
  const cells = patternCells(pattern, gridMetrics(state.gridSize).count);

  state.logos = cells.map((cell, index) => ({
    col: cell.col,
    row: cell.row,
    rotation: cell.rotation ?? (index % 2) * 90
  }));

  selectedLogo = 0;
  moves = {};
  keyframes = [cloneState()];
  selectedKeyframe = 0;
  refreshKeyframeList();
  updateLogoCount();
  showStatus('Patroon toegepast; keyframes opnieuw gestart');
}

function startDomino(continuous = false) {
  if (!state.logos.length) {
    showStatus('Voeg eerst een logo toe');
    return;
  }

  if (Object.keys(moves).length > 0) return;

  const sourceIndex = continuous
    ? floor(noise(dominoIteration * 0.19) * state.logos.length)
    : selectedLogo;
  const source = { ...state.logos[sourceIndex] };
  const gridCount = gridMetrics(state.gridSize).count;
  const positions = state.logos.map(logo => ({ ...logo }));
  const occupied = new Set(positions.map(logo => `${logo.col},${logo.row}`));
  const startingCells = new Set(occupied);
  const order = positions
    .map((logo, index) => ({
      index,
      distance: abs(logo.col - source.col) + abs(logo.row - source.row)
    }))
    .sort((a, b) => {
      if (a.index === sourceIndex) return -1;
      if (b.index === sourceIndex) return 1;
      return a.distance - b.distance;
    });

  const startTime = millis();
  const delay = 240 * stagger;
  let moved = 0;

  order.forEach(item => {
    const logo = positions[item.index];
    occupied.delete(`${logo.col},${logo.row}`);
    let awayX = logo.col - source.col;
    let awayY = logo.row - source.row;

    if (awayX === 0 && awayY === 0) {
      const direction = directionFromRotation(logo.rotation);
      awayX = direction.col;
      awayY = direction.row;
    }

    const candidates = [
      { col: logo.col + 1, row: logo.row },
      { col: logo.col - 1, row: logo.row },
      { col: logo.col, row: logo.row + 1 },
      { col: logo.col, row: logo.row - 1 }
    ]
      .filter(cell => (
        cell.col >= 0 && cell.col < gridCount &&
        cell.row >= 0 && cell.row < gridCount &&
        !startingCells.has(`${cell.col},${cell.row}`) &&
        !occupied.has(`${cell.col},${cell.row}`)
      ))
      .sort((a, b) => {
        const moveAX = a.col - logo.col;
        const moveAY = a.row - logo.row;
        const moveBX = b.col - logo.col;
        const moveBY = b.row - logo.row;
        const fieldAngle = noise(
          logo.col * 0.16,
          logo.row * 0.16,
          dominoIteration * 0.075
        ) * TWO_PI * 2;
        const directionX = continuous ? cos(fieldAngle) : awayX;
        const directionY = continuous ? sin(fieldAngle) : awayY;
        const scoreA = moveAX * directionX + moveAY * directionY;
        const scoreB = moveBX * directionX + moveBY * directionY;
        return scoreB - scoreA;
      });

    if (!candidates.length) {
      occupied.add(`${logo.col},${logo.row}`);
      return;
    }

    const target = candidates[0];
    const blocked = positions.filter((other, index) => index !== item.index);
    const path = buildRollPath(
      logo,
      target.col,
      target.row,
      gridCount,
      blocked
    );

    if (!path.length) {
      occupied.add(`${logo.col},${logo.row}`);
      return;
    }

    const endpoint = path[path.length - 1];
    moves[item.index] = {
      path,
      start: startTime + moved * delay,
      duration: 420
    };
    positions[item.index] = { ...endpoint };
    state.logos[item.index] = { ...endpoint };
    occupied.add(`${endpoint.col},${endpoint.row}`);
    moved++;
  });

  dominoIteration++;
  nextDominoAt = millis() + (moved ? 80 : 300);

  if (!continuous) {
    showStatus(moved ? 'Domino gestart' : 'Geen vrije cellen voor Domino');
  }
}

function updateDominoLoop() {
  if (
    !dominoLoop || !state.logos.length || playing || exporting || exportingPNG ||
    Object.keys(moves).length > 0 || millis() < nextDominoAt
  ) return;

  startDomino(true);
}

function directionFromRotation(rotation) {
  const quarter = ((round(rotation / 90) % 4) + 4) % 4;
  return [
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
    { col: 0, row: -1 }
  ][quarter];
}

function patternCells(pattern, size) {
  const cells = [];
  const center = floor(size / 2);
  const first = 1;
  const last = size - 2;

  if (pattern === 'empty') return cells;

  if (pattern === 'center') {
    return [
      { col: center, row: center, rotation: 0 },
      { col: center + 1, row: center, rotation: 90 }
    ];
  }

  if (pattern === 'line') {
    for (let col = first; col <= last; col++) {
      cells.push({
        col,
        row: center,
        rotation: (col - first) % 2 === 0 ? 0 : 90
      });
    }
    return cells;
  }

  if (pattern === 'cross') {
    for (let position = first; position <= last; position++) {
      cells.push({ col: position, row: center, rotation: position % 2 * 90 });
      if (position !== center) {
        cells.push({ col: center, row: position, rotation: position % 2 * 90 });
      }
    }
    return cells;
  }

  if (pattern === 'diagonal') {
    for (let position = first; position <= last; position++) {
      cells.push({ col: position, row: position, rotation: position % 2 * 90 });
      const mirror = size - 1 - position;
      if (mirror !== position) {
        cells.push({ col: mirror, row: position, rotation: position % 2 === 0 ? 90 : 0 });
      }
    }
    return cells;
  }

  if (pattern === 'ring') {
    for (let col = first; col <= last; col++) {
      cells.push({ col, row: first, rotation: col % 2 * 90 });
      if (last !== first) cells.push({ col, row: last, rotation: col % 2 * 90 });
    }
    for (let row = first + 1; row < last; row++) {
      cells.push({ col: first, row, rotation: row % 2 * 90 });
      cells.push({ col: last, row, rotation: row % 2 * 90 });
    }
    return cells;
  }

  if (pattern === 'steps') {
    for (let position = first; position <= last; position++) {
      cells.push({ col: position, row: position, rotation: position % 2 * 90 });
      if (position < last) {
        cells.push({ col: position + 1, row: position, rotation: position % 2 === 0 ? 90 : 0 });
      }
    }
    return cells;
  }

  for (let row = first; row <= last; row++) {
    for (let col = first; col <= last; col++) {
      if ((row + col) % 2 === 0) {
        cells.push({ col, row, rotation: cells.length % 2 * 90 });
      }
    }
  }

  return cells;
}

function addLogo() {
  const occupied = new Set(state.logos.map(logo => `${logo.col},${logo.row}`));
  const gridCount = gridMetrics(state.gridSize).count;
  let freeCell = null;

  for (let row = 1; row < gridCount - 1 && !freeCell; row++) {
    for (let col = 1; col < gridCount - 1; col++) {
      if (!occupied.has(`${col},${row}`)) {
        freeCell = { col, row };
        break;
      }
    }
  }

  if (!freeCell) {
    showStatus('Het grid is vol; maak het grid eerst groter');
    return;
  }

  const logo = {
    ...freeCell,
    rotation: state.logos.length % 2 === 0 ? 0 : 90
  };

  state.logos.push(logo);
  keyframes.forEach(keyframe => keyframe.logos.push({ ...logo }));
  selectedLogo = state.logos.length - 1;
  moves = {};
  updateLogoCount();
  showStatus(`Logo ${state.logos.length} toegevoegd`);
}

function removeLogo() {
  if (!state.logos.length) {
    showStatus('Er zijn geen logo’s om te verwijderen');
    return;
  }

  state.logos.splice(selectedLogo, 1);
  keyframes.forEach(keyframe => keyframe.logos.splice(selectedLogo, 1));
  selectedLogo = min(selectedLogo, state.logos.length - 1);
  moves = {};
  updateLogoCount();
  showStatus('Logo verwijderd');
}

function updateLogoCount() {
  document.getElementById('logo-count').textContent = state.logos.length;
}

function connectColors(containerId, property) {
  const container = document.getElementById(containerId);

  container.querySelectorAll('.swatch').forEach(button => {
    button.addEventListener('click', () => {
      state[property] = button.dataset.color;
      setActiveColor(container, button.dataset.color);
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
  keyframes.push(cloneState());
  selectedKeyframe = keyframes.length - 1;
  refreshKeyframeList();
  showStatus('Keyframe toegevoegd');
}

function updateKeyframe() {
  if (!keyframes[selectedKeyframe]) return;
  keyframes[selectedKeyframe] = cloneState();
  showStatus(`Keyframe ${selectedKeyframe + 1} aangepast`);
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
    option.textContent = `Keyframe ${index + 1}`;
    option.selected = index === selectedKeyframe;
    list.appendChild(option);
  });
}

function loadKeyframe() {
  selectedKeyframe = Number(document.getElementById('keyframe-list').value || selectedKeyframe);
  if (!keyframes[selectedKeyframe]) return;
  state = cloneState(keyframes[selectedKeyframe]);
  moves = {};
  syncControls();
}

function syncControls() {
  document.getElementById('grid-size').value = state.gridSize;
  document.getElementById('show-grid').checked = state.showGrid;
  document.getElementById('logo-variant').value = state.logoVariant || 'original';
  updateLogoCount();
  setActiveColor(document.getElementById('foreground-colors'), state.foreground);
  setActiveColor(document.getElementById('background-colors'), state.background);
}

function togglePlayback() {
  if (playing) return stopPlayback();
  if (keyframes.length < 2) return showStatus('Voeg minimaal 2 keyframes toe');

  moves = {};
  playing = true;
  animationStart = millis();
  document.getElementById('play').textContent = 'Stop';
}

function stopPlayback() {
  playing = false;
  document.getElementById('play').textContent = 'Play';
}

function animationDuration() {
  let duration = 0;

  for (let i = 0; i < keyframes.length - 1; i++) {
    duration += keyframeTransitionDuration(i);
  }

  return duration;
}

function keyframeTransitionDuration(index) {
  return transitionPlan(index).duration;
}

function transitionPlan(index) {
  const from = keyframes[index];
  const to = keyframes[index + 1];
  const gridCount = gridMetrics(from.gridSize).count;
  const positions = from.logos.map(logo => ({ ...logo }));
  const remaining = positions.map((logo, logoIndex) => logoIndex);
  const items = [];
  const reservedCells = [];

  while (remaining.length) {
    let planned = false;

    for (let remainingIndex = 0; remainingIndex < remaining.length; remainingIndex++) {
      const logoIndex = remaining[remainingIndex];
      const target = to.logos[logoIndex];
      const blocked = positions
        .filter((logo, index) => index !== logoIndex)
        .concat(stagger < 1 ? reservedCells : []);
      const path = buildRollPath(
        positions[logoIndex],
        target.col,
        target.row,
        gridCount,
        blocked
      );

      if (!path.length) continue;

      items.push({ logoIndex, path, weight: pathWeight(path) });
      reservedCells.push(...path);
      positions[logoIndex] = { ...target };
      remaining.splice(remainingIndex, 1);
      planned = true;
      break;
    }

    if (!planned) return { items: [], duration: transitionLength };
  }

  const movingItems = items.filter(item => item.weight > 0);
  const slot = movingItems.length > 0
    ? transitionLength / movingItems.length
    : transitionLength;
  const delay = slot * stagger;
  const movementDuration = transitionLength - delay * max(0, movingItems.length - 1);
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

  return { items, duration: transitionLength };
}

function playbackState(elapsed) {
  if (keyframes.length < 2) return state;

  let segment = 0;
  let segmentStart = 0;

  while (segment < keyframes.length - 2) {
    const duration = keyframeTransitionDuration(segment);
    if (elapsed <= segmentStart + duration) break;
    segmentStart += duration;
    segment++;
  }

  const plan = transitionPlan(segment);
  const duration = plan.duration;
  const segmentElapsed = elapsed - segmentStart;
  const raw = constrain(segmentElapsed / duration, 0, 1);
  const eased = applyEasing(raw);
  const colorProgress = constrain(eased, 0, 1);
  const from = keyframes[segment];
  const to = keyframes[segment + 1];
  const logos = from.logos.map(logo => ({ ...logo }));

  plan.items.forEach(item => {
    const target = to.logos[item.logoIndex];

    if (segmentElapsed >= item.start + item.duration) {
      logos[item.logoIndex] = { ...target };
    } else if (segmentElapsed >= item.start && item.duration > 0) {
      const progress = constrain(
        (segmentElapsed - item.start) / item.duration,
        0,
        1
      );
      logos[item.logoIndex] = rollPathPose(
        item.path,
        progress,
        from.gridSize
      );
    }
  });

  return {
    gridSize: from.gridSize,
    showGrid: from.showGrid,
    logoVariant: raw < 0.5
      ? (from.logoVariant || 'original')
      : (to.logoVariant || 'original'),
    foreground: lerpColor(color(from.foreground), color(to.foreground), colorProgress).toString('#rrggbb'),
    background: lerpColor(color(from.background), color(to.background), colorProgress).toString('#rrggbb'),
    logos
  };
}

function applyEasing(amount) {
  const t = constrain(amount, 0, 1);
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  const c3 = c1 + 1;
  const c4 = (2 * Math.PI) / 3;
  const c5 = (2 * Math.PI) / 4.5;

  switch (easingType) {
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
  const oldCount = gridMetrics(state.gridSize).count;
  resizeCanvas(newWidth, newHeight);
  fitCanvasPreview();
  const newCount = gridMetrics(state.gridSize).count;
  const shift = (newCount - oldCount) / 2;

  state.logos.forEach(logo => {
    logo.col += shift;
    logo.row += shift;
  });

  moves = {};
}

function fitCanvasPreview() {
  if (!canvasElement || !canvasContainer) return;

  const availableWidth = canvasContainer.clientWidth;
  const availableHeight = canvasContainer.clientHeight;

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

  canvasElement.style.width = `${floor(width * scale)}px`;
  canvasElement.style.height = `${floor(height * scale)}px`;
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
  if (keyframes.length < 2) return showStatus('Voeg minimaal 2 keyframes toe');
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
