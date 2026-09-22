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

// Every envelope uses one shared travel direction. Departing marks roll from
// the source cell to the right; arriving marks start left of their target and
// continue in that same direction into it.
const ENVELOPE_DIRECTION = Object.freeze({ col: 1, row: 0 });

let state = {
  mode: 'logo',
  pattern: 'alternating',
  gridSize: 64,
  gridPhase: 0,
  focusOnLogo: false,
  showGrid: false,
  logoVariant: 'original',
  logoText: 'NOORDZUID',
  textRepeat: true,
  logoLayout: 'horizontal',
  noiseMotion: 'playful',
  noiseDensity: 'balanced',
  fall: false,
  foreground: '#FF8D8C',
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
let textGlyphInkCache = {};
let textGlyphWeightCache = {};
let noiseIteration = 0;
let nextNoiseMoveAt = 0;
let fallBodies = [];
let lastFallUpdate = 0;
let playbackFallActive = false;
let playbackFallLayoutKey = null;
let playbackNoiseRuntime = null;
let playbackNoiseSources = {};
let fallResume = null;
let lastPlaybackFallState = null;
let fallReturnTransition = null;
let liveFallReturn = null;
let keyframePreviewTransition = null;

function preload() {
  LOGO_VARIANTS.forEach(variant => {
    if (variant.path) logoImages[variant.id] = loadImage(variant.path);
  });
}

function setup() {
  const initialWidth = constrain(
    Number(document.getElementById('canvas-width').value) || 1000,
    200,
    6000
  );
  const initialHeight = constrain(
    Number(document.getElementById('canvas-height').value) || 600,
    200,
    6000
  );
  const canvas = createCanvas(initialWidth, initialHeight);
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

  state.gridSize = nearestZoomLevel(state.gridSize);
  connectControls();
  applyLogoPreset();
  addKeyframe();
  syncControls();
  if (document.fonts) {
    document.fonts.load('100px Saans').then(() => {
      clearLogoRenderCache();
      preloadTextGlyphs(state.logoText);
    });
  }
  showStatus('Linksklik om te rollen · rechtermuisklik om een cel te vullen of legen');
}

function draw() {
  if (!liveFallReturn && !keyframePreviewTransition) {
    updateNoiseMotion();
    updateFallMotion();
  }
  let drawingState = state;
  if (keyframePreviewTransition && !playing && !exporting) {
    const elapsed = millis() - keyframePreviewTransition.start;
    drawingState = keyframePreviewState(elapsed);
    if (elapsed >= keyframePreviewTransition.duration) {
      state = cloneState(keyframePreviewTransition.target);
      drawingState = state;
      keyframePreviewTransition = null;
      nextNoiseMoveAt = millis() + 250;
    }
  }
  if (liveFallReturn && !playing && !exporting) {
    const elapsed = millis() - liveFallReturn.start;
    drawingState = fallReturnState(liveFallReturn, state, elapsed, liveFallReturn.duration);
    if (liveFallReturn.complete) {
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
      playbackFallLayoutKey = null;
    }

    if (drawingState.mode === 'noise' && !isFalling(drawingState) && drawingState.noiseRunning !== false) {
      drawingState = playbackNoiseState(drawingState);
    } else {
      playbackNoiseRuntime = null;
    }

    if (
      playing && elapsed >= animationDuration() &&
      (!fallReturnTransition || fallReturnTransition.complete)
    ) {
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

  const visibleLogos = drawingState.logos.flatMap((logo, index) => {
    if (playing || exporting) return [logo];
    const visibleLogo = movingLogo(index, logo);
    const exitingLogo = movingEnvelopeExit(index);
    return exitingLogo ? [visibleLogo, exitingLogo] : [visibleLogo];
  });
  // Envelope moves temporarily draw both an outgoing and incoming pose. Keep
  // the grid anchored to the logical layout instead of letting that extra pose
  // change the two-logo half-cell offset.
  const drawingGrid = viewGridMetrics({
    ...drawingState,
    logos: visibleLogos,
    viewOffset: drawingState.viewOffset || logoGridOffset(drawingState)
  });

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
  const maximumColumns = floor(((width / 32 + gutter) / (1 + gutter)) / 2) * 2;
  const levels = [];

  // Zoom is measured across the width and anchored to the centre. Changing
  // the total fit by two pitches moves each side by exactly one cell + gutter.
  // The extra pitch makes the visible column count odd, so a centred pattern
  // starts and ends with full cells instead of two clipped half-cells.
  // Only the resulting pixel size is stored in state/keyframes, never this index.
  for (let columns = maximumColumns; columns >= 0; columns -= 2) {
    const visibleColumns = columns + 1;
    levels.push(width / (visibleColumns * (1 + gutter) - gutter));
  }
  return levels;
}

function nearestZoomLevel(size) {
  const levels = zoomLevels();
  return levels.reduce((nearest, level) => (
    abs(level - size) < abs(nearest - size) ? level : nearest
  ), levels[0]);
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
  document.getElementById('grid-size-value').value = `${round(state.gridSize)} px`;
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
  if (
    source.mode === 'logo' && source.logoVariant === 'text' &&
    source.textRepeat === false && textCharacters(source).length % 2 === 0
  ) return { x: 0.5, y: 0 };
  if (source.mode !== 'logo' || source.logos.length !== 2) return { x: 0, y: 0 };
  return source.logoLayout === 'vertical' ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 };
}

function transitionViewport(from, to, progress) {
  // Recalculate the grid around the canvas centre at every zoom frame. Linear
  // interpolation of the old/new top-left corners makes the visual centre
  // drift whenever the number of visible rows or columns changes.
  const currentGrid = gridMetrics(lerp(from.gridSize, to.gridSize, progress));
  const fromOffset = logoGridOffset(from);
  const toOffset = logoGridOffset(to);
  return {
    gridOrigin: {
      left: currentGrid.left,
      top: currentGrid.top
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
  const length = grid.cell * (logo.renderScale || 1);
  const center = cellCenter(logo.col, logo.row, grid);
  const x = center.x;
  const y = center.y;
  const logoVariant = logo.styleVariant || (drawingState.logoVariant === 'vary'
    ? (logo.variant || noiseVariantFor(round(logo.col), round(logo.row), 0, logoIndex))
    : drawingState.logoVariant);

  push();
  applyLogoEnvelope(logo.transitionEnvelope, grid);
  translate(x, y);
  if (logoVariant !== 'text') {
    rotate(radians(logo.rotation));
  } else if (drawingState.mode === 'noise') {
    rotate(radians(logo.rotation));
  } else if (Number.isFinite(logo.textRotation)) {
    rotate(radians(logo.textRotation));
  }

  if (logoVariant === 'text') {
    drawTextLogo(
      drawingState,
      logo.glyphIndex ?? logoIndex,
      length,
      logo.textCharacter
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

// Pattern/noise transitions treat a cell like an envelope. A departing logo
// is visible only until it rolls behind the next cell; an arriving logo is
// revealed only after it rolls out through the relevant edge of its envelope.
function applyLogoEnvelope(envelope, grid) {
  if (!envelope) return;

  const left = grid.left + envelope.col * grid.pitch;
  const top = grid.top + envelope.row * grid.pitch;
  const right = left + grid.cell;
  const bottom = top + grid.cell;
  const extent = max(width, height) * 4;
  const context = drawingContext;

  context.beginPath();
  if (envelope.direction.col > 0) {
    context.rect(
      envelope.kind === 'enter' ? left : -extent,
      -extent,
      envelope.kind === 'enter' ? extent * 2 : right + extent,
      extent * 2
    );
  } else if (envelope.direction.col < 0) {
    context.rect(
      envelope.kind === 'enter' ? -extent : left,
      -extent,
      envelope.kind === 'enter' ? right + extent : extent * 2,
      extent * 2
    );
  } else if (envelope.direction.row > 0) {
    context.rect(
      -extent,
      envelope.kind === 'enter' ? top : -extent,
      extent * 2,
      envelope.kind === 'enter' ? extent * 2 : bottom + extent
    );
  } else {
    context.rect(
      -extent,
      envelope.kind === 'enter' ? -extent : top,
      extent * 2,
      envelope.kind === 'enter' ? bottom + extent : extent * 2
    );
  }
  context.clip();
}

function textCharacters(source) {
  const characters = Array.from(source.logoText ?? 'NOORDZUID');
  return characters.length ? characters : [''];
}

function textCharacterAt(source, logoIndex) {
  const characters = textCharacters(source);
  if (source.textRepeat === false) {
    return source.logos[logoIndex]?.textCharacter ?? '';
  }
  return characters[logoIndex % characters.length];
}

function assignTextCharacters(source, logos, grid = gridMetrics(source.gridSize)) {
  logos.forEach(logo => { delete logo.textCharacter; });
  if (source.logoVariant !== 'text' || source.textRepeat !== false) return logos;

  const characters = textCharacters(source);
  const view = viewGridMetrics({ ...source, logos, viewFocus: 0 });
  const visible = logos.map((logo, index) => ({
    index,
    logo,
    center: cellCenter(logo.col, logo.row, view)
  })).filter(({ center }) => (
    center.x >= 0 && center.x <= width && center.y >= 0 && center.y <= height
  ));
  const amount = min(characters.length, visible.length);
  if (!amount) return logos;

  const centerCol = (grid.cols - 1) / 2;
  const centerRow = (grid.rows - 1) / 2;
  const rows = new Map();
  visible.forEach(item => {
    const row = round(item.logo.row);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(item);
  });
  const fittingRows = [...rows.entries()]
    .filter(([, items]) => items.length >= amount)
    .sort((a, b) => abs(a[0] - centerRow) - abs(b[0] - centerRow));

  let selected;
  if (fittingRows.length) {
    selected = fittingRows[0][1]
      .sort((a, b) => abs(a.logo.col - centerCol) - abs(b.logo.col - centerCol))
      .slice(0, amount)
      .sort((a, b) => a.logo.col - b.logo.col);
  } else {
    selected = [...visible]
      .sort((a, b) => {
        const distanceA = sq(a.logo.col - centerCol) + sq(a.logo.row - centerRow);
        const distanceB = sq(b.logo.col - centerCol) + sq(b.logo.row - centerRow);
        return distanceA - distanceB;
      })
      .slice(0, amount)
      .sort((a, b) => a.logo.row - b.logo.row || a.logo.col - b.logo.col);
  }

  selected.forEach((item, index) => {
    logos[item.index].textCharacter = characters[index];
  });
  return logos;
}

function logosShareContent(from, to, sourceIndex, targetIndex) {
  const fromStyle = from.logoVariant || 'original';
  const toStyle = to.logoVariant || 'original';
  if (fromStyle !== toStyle) return false;
  if (fromStyle === 'vary') {
    return (from.logos[sourceIndex]?.variant || 'original') ===
      (to.logos[targetIndex]?.variant || 'original');
  }
  if (fromStyle === 'text') {
    return textCharacterAt(from, sourceIndex) === textCharacterAt(to, targetIndex);
  }
  return true;
}

function logoStyleAt(source, logoIndex) {
  const style = source.logoVariant || 'original';
  return style === 'vary'
    ? (source.logos[logoIndex]?.variant || 'original')
    : style;
}

function logosExactlyMatch(from, to, sourceIndex, targetIndex) {
  return logosShareContent(from, to, sourceIndex, targetIndex);
}

function preloadTextGlyphs(content) {
  const characters = Array.from(content ?? '');
  [...new Set(characters)].forEach(character => renderedTextGlyph(character));
}

function drawTextLogo(drawingState, logoIndex, size, characterOverride) {
  const character = characterOverride ?? textCharacterAt(drawingState, logoIndex);
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
  buffer.pixelDensity(1);
  buffer.clear();
  buffer.noStroke();
  buffer.fill(255);
  buffer.textFont('Saans');
  buffer.textStyle(NORMAL);
  buffer.textSize(measureSize);

  // Use one shared font size based on the widest reference glyph. Individual
  // letters keep their natural width instead of each being stretched to fill
  // the square cell independently.
  const reference = buffer.drawingContext.measureText('W');
  const referenceWidth = Number.isFinite(reference.actualBoundingBoxLeft) &&
    Number.isFinite(reference.actualBoundingBoxRight)
    ? reference.actualBoundingBoxLeft + reference.actualBoundingBoxRight
    : buffer.textWidth('W');
  const referenceHeight = Number.isFinite(reference.actualBoundingBoxAscent) &&
    Number.isFinite(reference.actualBoundingBoxDescent)
    ? reference.actualBoundingBoxAscent + reference.actualBoundingBoxDescent
    : buffer.textAscent() + buffer.textDescent();
  const fittedSize = measureSize * (bufferSize * 0.9) /
    max(referenceWidth, referenceHeight, 1);

  buffer.textSize(fittedSize);
  let metrics = buffer.drawingContext.measureText(character);
  const hasExactBounds = Number.isFinite(metrics.actualBoundingBoxLeft) &&
    Number.isFinite(metrics.actualBoundingBoxRight) &&
    Number.isFinite(metrics.actualBoundingBoxAscent) &&
    Number.isFinite(metrics.actualBoundingBoxDescent);
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

function glyphInkAmount(character) {
  const cacheKey = `${character}-${pixelDensity()}`;
  if (textGlyphInkCache[cacheKey] !== undefined) {
    return textGlyphInkCache[cacheKey];
  }
  const glyph = renderedTextGlyph(character);
  glyph.loadPixels();
  let ink = 0;
  for (let index = 3; index < glyph.pixels.length; index += 4) {
    ink += glyph.pixels[index] / 255;
  }
  textGlyphInkCache[cacheKey] = ink;
  return ink;
}

function textCharacterWeight(character) {
  const cacheKey = `${character}-${pixelDensity()}`;
  if (textGlyphWeightCache[cacheKey] !== undefined) {
    return textGlyphWeightCache[cacheKey];
  }

  const ink = glyphInkAmount(character);
  const referenceInk = max(1, glyphInkAmount('W'));
  // Calibrated so a full capital W is about 80 and a small punctuation mark
  // lands around 10. Blank characters still exist in the simulation, but are
  // intentionally almost weightless.
  const weight = ink <= 0
    ? 1
    : round(constrain(8 + 72 * ink / referenceInk, 1, 100));
  textGlyphWeightCache[cacheKey] = weight;
  return weight;
}

function fallWeight(source, logoIndex) {
  return logoStyleAt(source, logoIndex) === 'text'
    ? textCharacterWeight(textCharacterAt(source, logoIndex))
    : 60;
}

function renderedLogo(variantId, foreground, size) {
  // Cache one generously sized coloured source per variant. Rebuilding a new
  // p5 graphics buffer for every intermediate zoom size caused visible stalls
  // in fields containing many copies of the same mark.
  const cacheKey = `${variantId}-${foreground}-${pixelDensity()}`;
  if (logoRenderCache[cacheKey]) return logoRenderCache[cacheKey];

  if (Object.keys(logoRenderCache).length >= 80) {
    clearLogoRenderCache();
  }

  const source = logoImages[variantId] || logoImages.original;
  const bufferSize = 512;
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
  textGlyphInkCache = {};
  textGlyphWeightCache = {};
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
  if (blocked.some(logo => logo.col === targetCol && logo.row === targetRow)) {
    showStatus('Deze cel is al bezet');
    return;
  }
  if (from.col === targetCol && from.row === targetRow) return;

  const distance = abs(targetCol - from.col) + abs(targetRow - from.row);
  const duration = timingFromControls().animationDuration;
  let to;

  if (distance === 1) {
    to = {
      ...from,
      col: targetCol,
      row: targetRow,
      rotation: from.rotation + anchoredTurn(from, { col: targetCol, row: targetRow })
    };
    moves[index] = {
      kind: 'step',
      from,
      to,
      path: [{ ...from }, { ...to }],
      start: millis(),
      duration
    };
  } else {
    const direction = ENVELOPE_DIRECTION;
    to = {
      ...from,
      col: targetCol,
      row: targetRow,
      rotation: cellRotation(targetCol, targetRow, from.rotation)
    };
    const exitTarget = {
      col: from.col + direction.col,
      row: from.row + direction.row
    };
    const enterStart = {
      col: to.col - direction.col,
      row: to.row - direction.row
    };
    moves[index] = {
      kind: 'envelope',
      from,
      to,
      exitPath: [{ ...from }, {
        ...exitTarget,
        rotation: from.rotation + anchoredTurn(from, exitTarget)
      }],
      enterPath: [{
        ...enterStart,
        rotation: to.rotation - anchoredTurn(enterStart, to)
      }, { ...to }],
      exitEnvelope: {
        kind: 'exit',
        col: from.col,
        row: from.row,
        direction
      },
      enterEnvelope: {
        kind: 'enter',
        col: to.col,
        row: to.row,
        direction
      },
      start: millis(),
      duration
    };
  }
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
  if (move.kind === 'envelope') {
    const visibleLogo = {
      ...move.to,
      ...rollPathPose(move.enterPath, raw, state.gridSize),
      transitionEnvelope: move.enterEnvelope,
      glyphIndex: index
    };
    visibleLogo.textRotation = visibleLogo.rotation - move.to.rotation;

    if (move.fromVariant || move.toVariant) {
      visibleLogo.variant = move.toVariant || move.fromVariant;
    }
    return visibleLogo;
  }

  const visibleLogo = {
    ...fallback,
    ...rollPathPose(move.path, raw, state.gridSize)
  };
  if (move.kind === 'step' && state.logoVariant === 'text' && state.mode !== 'noise') {
    const totalTurn = move.path[move.path.length - 1].rotation - move.path[0].rotation;
    visibleLogo.textRotation = sin(PI * raw) * totalTurn;
  } else {
    visibleLogo.textRotation = visibleLogo.rotation - move.path[0].rotation;
  }

  if (move.fromVariant || move.toVariant) {
    visibleLogo.variant = raw < 0.5
      ? (move.fromVariant || move.toVariant)
      : (move.toVariant || move.fromVariant);
  }

  return visibleLogo;
}

function movingEnvelopeExit(index) {
  const move = moves[index];
  if (!move || move.kind !== 'envelope') return null;

  const raw = constrain((millis() - move.start) / move.duration, 0, 1);
  if (raw >= 1) return null;

  const visibleLogo = {
    ...move.from,
    ...rollPathPose(move.exitPath, raw, state.gridSize),
    transitionEnvelope: move.exitEnvelope,
    glyphIndex: index
  };
  visibleLogo.textRotation = visibleLogo.rotation - move.from.rotation;
  if (move.fromVariant || move.toVariant) {
    visibleLogo.variant = move.fromVariant || move.toVariant;
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
    if (state.logoVariant === 'text' && state.mode === 'noise') {
      state.logos.forEach(logo => { logo.rotation = 0; });
      moves = {};
      nextNoiseMoveAt = millis() + 250;
    }
    if (state.logoVariant === 'text') preloadTextGlyphs(state.logoText);
    if (state.mode === 'logo' && state.logoVariant === 'text' && state.textRepeat === false) {
      applyLogoPreset();
    } else {
      assignTextCharacters(state, state.logos);
    }
    updateTextControls();
    autoUpdateKeyframe();
  });
  document.getElementById('logo-text').addEventListener('input', event => {
    state.logoText = event.target.value;
    preloadTextGlyphs(state.logoText);
    if (state.mode === 'logo' && state.logoVariant === 'text' && state.textRepeat === false) {
      applyLogoPreset();
    } else {
      assignTextCharacters(state, state.logos);
    }
    autoUpdateKeyframe();
  });
  document.getElementById('text-once').addEventListener('change', event => {
    state.textRepeat = !event.target.checked;
    if (state.mode === 'logo') applyLogoPreset();
    else assignTextCharacters(state, state.logos);
    if (isFalling(state)) resetFallBodies();
    autoUpdateKeyframe();
  });

  modeControl.addEventListener('change', event => {
    setMode(event.target.value);
    if (isFalling(state)) {
      // The newly selected mode/layout is now the state to restore when Fall
      // is switched off; do not keep the snapshot from when Fall began.
      state.preFallLogos = state.logos.map(logo => ({ ...logo }));
      fallResume = null;
    }
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
    if (!isFalling(state)) {
      if (state.mode === 'pattern') {
        state.logos = patternLogosFor(state, newGrid, state.logos);
      } else if (state.mode === 'noise') {
        state.logos = noiseLogosFor(state, newGrid, state.logos);
        nextNoiseMoveAt = millis() + 250;
      }
    }
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
    const departingBodies = fallBodies.map(body => ({
      ...body,
      bounds: { ...body.bounds }
    }));
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
        bodies: departingBodies.length ? departingBodies : createFallBodies(fallen),
        lastFallUpdate: millis(),
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
  state.logos = patternLogosFor(state, gridMetrics(state.gridSize));
  if (isFalling(state)) resetFallBodies();

  selectedLogo = 0;
  moves = {};
  showStatus('Patroon toegepast');
}

function patternLogosFor(source, grid, previousLogos = []) {
  const previousVariants = new Map(previousLogos.map(logo => (
    [`${round(logo.col)},${round(logo.row)}`, logo.variant]
  )));

  const logos = patternCells(source.pattern || 'alternating', grid).map((cell, index) => {
    const logo = {
      col: cell.col,
      row: cell.row,
      rotation: cellRotation(cell.col, cell.row, 0, source.gridPhase || 0)
    };

    if (source.logoVariant === 'vary') {
      logo.variant = previousVariants.get(`${cell.col},${cell.row}`) ||
        noiseVariantFor(cell.col, cell.row, noiseIteration, index);
    }
    return logo;
  });
  return assignTextCharacters(source, logos, grid);
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
  state.noiseFieldIteration = noiseIteration;
  state.logos = noiseLogosFor(state, grid, [], state.noiseFieldIteration);
  selectedLogo = 0;
  noiseIteration++;
  moves = {};
  nextNoiseMoveAt = millis() + 250;
  showStatus('Noise veld beweegt automatisch');
  if (isFalling(state)) resetFallBodies();
}

function noiseLogosFor(
  source,
  grid,
  previousLogos = [],
  iteration = source.noiseFieldIteration ?? noiseIteration
) {
  const density = {
    airy: 0.2,
    balanced: 0.34,
    full: 0.48
  }[source.noiseDensity || 'balanced'];
  const amount = max(2, round(grid.cols * grid.rows * density));
  const centerCol = (grid.cols - 1) / 2;
  const centerRow = (grid.rows - 1) / 2;
  const previousByCell = new Map();

  previousLogos.forEach(logo => {
    const col = round(logo.col);
    const row = round(logo.row);
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return;
    previousByCell.set(`${col},${row}`, logo);
  });

  const cells = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const seed = sin(
        (col - centerCol + 101) * 12.9898 +
        (row - centerRow + 101) * 78.233 +
        (iteration + 1) * 37.719
      ) * 43758.5453;
      cells.push({ col, row, score: seed - floor(seed) });
    }
  }

  const retained = cells.filter(cell => previousByCell.has(`${cell.col},${cell.row}`));
  const additions = cells
    .filter(cell => !previousByCell.has(`${cell.col},${cell.row}`))
    .sort((a, b) => b.score - a.score);
  const selected = retained.length >= amount
    ? retained.sort((a, b) => b.score - a.score).slice(0, amount)
    : retained.concat(additions.slice(0, amount - retained.length));

  const logos = selected.map(({ col, row }, index) => {
    const previous = previousByCell.get(`${col},${row}`);
    return {
      col,
      row,
      rotation: previous?.rotation ?? (source.logoVariant === 'text'
        ? 0
        : cellRotation(col, row, 0, source.gridPhase || 0)),
      ...(source.logoVariant === 'vary'
        ? {
            variant: previous?.variant || noiseVariantFor(
              col - centerCol,
              row - centerRow,
              iteration,
              index
            )
          }
        : {})
    };
  });
  return assignTextCharacters(source, logos, grid);
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

  const previousGridSize = playbackNoiseRuntime.state.gridSize;
  const zoomChanged = abs(previousGridSize - drawingState.gridSize) > 0.0001;

  if (zoomChanged) {
    const previousGrid = gridMetrics(previousGridSize);
    const currentGrid = gridMetrics(drawingState.gridSize);
    playbackNoiseRuntime.state.logos = playbackNoiseRuntime.state.logos.map(logo => (
      logoFromCenteredPosition(
        logo,
        centeredGridPosition(logo, previousGrid),
        currentGrid
      )
    ));

    // A procedural one-cell move belongs to the old grid scale. Pause and
    // restart it after zoom settles instead of letting it pull the field away
    // from the shared centre anchor.
    playbackNoiseRuntime.moves = {};
    playbackNoiseRuntime.nextMoveAt = millis() + 250;
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

function createFallBodies(sourceState = state) {
  const grid = gridMetrics(sourceState.gridSize);
  const view = viewGridMetrics(sourceState);
  const viewportLeft = grid.left - view.left;
  const viewportTop = grid.top - view.top;
  const bounds = {
    left: viewportLeft,
    right: viewportLeft + width,
    top: viewportTop,
    bottom: viewportTop + height
  };

  if (sourceState.logoVariant === 'text' && sourceState.textRepeat === false) {
    const characters = textCharacters(sourceState);
    const fittedCell = min(
      grid.cell,
      width / max(1, characters.length * 1.25),
      height * 0.35
    );
    const renderScale = fittedCell / grid.cell;
    const fittedPitch = fittedCell * (1 + 10 / 64);
    return characters.map((character, index) => {
      const weight = textCharacterWeight(character);
      const x = viewportLeft + width / 2 +
        (index - (characters.length - 1) / 2) * fittedPitch;
      const y = viewportTop + height / 2;
      const extent = fittedCell * 0.5 + 3;
      return {
        x: constrain(x, bounds.left + extent, bounds.right - extent),
        y: constrain(y, bounds.top + extent, bounds.bottom - extent),
        vx: sin((index + 1) * 2.17) * 18 * (1.15 - weight / 150),
        vy: 0,
        rotation: 0,
        angularVelocity: sin((index + 1) * 1.37) * 4,
        weight,
        glyphIndex: index,
        textCharacter: character,
        styleVariant: 'text',
        renderScale,
        collisionRadius: fittedCell * 0.46,
        bounds: { ...bounds }
      };
    });
  }

  return sourceState.logos.map((logo, index) => {
    const center = cellCenter(logo.col, logo.row, grid);
    return { logo, index, center };
  }).filter(({ center }) => (
    // Procedural grids include fully off-canvas edge cells so zooming remains
    // centred. They must not be clamped into view when physics starts, or a
    // seven-line pattern visibly grows to nine lines.
    center.x >= viewportLeft && center.x <= viewportLeft + width &&
    center.y >= viewportTop && center.y <= viewportTop + height
  )).map(({ logo, index, center }) => {
    const angle = radians(logo.rotation);
    const renderScale = logo.renderScale || 1;
    const extent = grid.cell * renderScale * 0.5 *
      (abs(cos(angle)) + abs(sin(angle))) + 3;
    const weight = fallWeight(sourceState, index);
    return {
      x: constrain(center.x, bounds.left + extent, bounds.right - extent),
      y: constrain(center.y, bounds.top + extent, bounds.bottom - extent),
      vx: sin((index + 1) * 2.17) * 18 * (1.15 - weight / 150),
      vy: 0,
      rotation: logo.rotation,
      angularVelocity: sin((index + 1) * 1.37) * 4,
      weight,
      variant: logo.variant,
      glyphIndex: logo.glyphIndex ?? index,
      textCharacter: logo.textCharacter,
      styleVariant: logo.styleVariant,
      renderScale,
      collisionRadius: grid.cell * renderScale * 0.46,
      bounds: { ...bounds }
    };
  });
}

function resetFallBodies(sourceState = state) {
  fallBodies = createFallBodies(sourceState);
  lastFallUpdate = millis();
}

function updateFallMotion() {
  if (!isFalling(state) || playing || exporting || exportingPNG) return;

  if (!fallBodies.length && state.logos.length) resetFallBodies();
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
    playbackFallLayoutKey = fallLayoutKey(drawingState);
  } else {
    const nextLayoutKey = fallLayoutKey(drawingState);
    if (nextLayoutKey !== playbackFallLayoutKey) {
      reconcileFallBodies(drawingState);
      playbackFallLayoutKey = nextLayoutKey;
    }
  }

  lastPlaybackFallState = {
    ...drawingState,
    logos: stepFallBodies(drawingState)
  };
  return lastPlaybackFallState;
}

function fallLayoutKey(source) {
  return JSON.stringify([
    source.mode,
    source.pattern,
    source.logoLayout,
    source.logoVariant,
    source.logoText,
    source.textRepeat,
    source.logos.length
  ]);
}

function reconcileFallBodies(sourceState) {
  const desiredBodies = createFallBodies(sourceState);
  const desiredCount = desiredBodies.length;

  if (desiredCount < fallBodies.length) {
    const previousBodies = fallBodies;
    fallBodies = Array.from({ length: desiredCount }, (_, index) => (
      previousBodies[min(
        previousBodies.length - 1,
        floor(index * previousBodies.length / max(1, desiredCount))
      )]
    ));
  } else if (desiredCount > fallBodies.length) {
    fallBodies.push(...desiredBodies.slice(fallBodies.length));
  }

  fallBodies.forEach((body, index) => {
    const desired = desiredBodies[index];
    if (!desired) return;
    body.weight = desired.weight;
    body.variant = desired.variant;
    body.glyphIndex = desired.glyphIndex;
    body.textCharacter = desired.textCharacter;
    body.styleVariant = desired.styleVariant;
    body.renderScale = desired.renderScale;
    body.collisionRadius = desired.collisionRadius;
  });
}

function stepFallBodies(sourceState, options = {}) {
  const bodies = options.bodies || fallBodies;
  if (!bodies.length) return [];

  const now = millis();
  const previousUpdate = options.clock
    ? (options.clock.lastFallUpdate ?? now)
    : lastFallUpdate;
  const elapsed = constrain((now - previousUpdate) / 1000, 0, 0.04);
  if (options.clock) options.clock.lastFallUpdate = now;
  else lastFallUpdate = now;
  const grid = gridMetrics(sourceState.gridSize);
  const view = viewGridMetrics(sourceState);
  const viewportLeft = grid.left - view.left;
  const viewportTop = grid.top - view.top;
  const collisionPadding = 3;
  const steps = 4;
  const dt = elapsed / steps;

  for (let step = 0; elapsed > 0 && step < steps; step++) {
    bodies.forEach(body => {
      const gravityScale = 0.35 + 1.05 * body.weight / 100;
      body.vy += 980 * gravityScale * dt;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      body.rotation += body.angularVelocity * dt;

      const angle = radians(body.rotation);
      const bodySize = grid.cell * (body.renderScale || 1);
      const extent = bodySize * 0.5 *
        (abs(cos(angle)) + abs(sin(angle))) + collisionPadding;

      const bounds = body.bounds;
      bounds.left = viewportLeft;
      bounds.right = viewportLeft + width;
      bounds.top = viewportTop;
      bounds.bottom = viewportTop + height;
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
      } else if (!options.allowBottomExit && body.y + extent > bounds.bottom) {
        body.y = bounds.bottom - extent;
        const impact = abs(body.vy);
        const restitution = lerp(0.3, 0.12, body.weight / 100);
        body.vy = impact > 35 ? -impact * restitution : 0;
        body.vx *= 0.88;
        body.angularVelocity *= 0.68;
      }

      body.angularVelocity = constrain(body.angularVelocity, -10, 10);
    });

    resolveFallCollisions(bodies, grid.cell * 0.46, collisionPadding);
    bodies.forEach(body => {
      const angle = radians(body.rotation);
      const bodySize = grid.cell * (body.renderScale || 1);
      const extent = bodySize * 0.5 *
        (abs(cos(angle)) + abs(sin(angle))) + collisionPadding;
      body.x = constrain(body.x, body.bounds.left + extent, body.bounds.right - extent);
      body.y = options.allowBottomExit
        ? max(body.y, body.bounds.top + extent)
        : constrain(body.y, body.bounds.top + extent, body.bounds.bottom - extent);
    });
  }

  return bodies.map(body => ({
    ...canvasPointToLogo({ x: body.x, y: body.y }, body.rotation, grid),
    variant: body.variant,
    glyphIndex: body.glyphIndex,
    textCharacter: body.textCharacter,
    styleVariant: body.styleVariant,
    renderScale: body.renderScale
  }));
}

function resolveFallCollisions(bodies, radius, padding) {
  for (let firstIndex = 0; firstIndex < bodies.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex++) {
      const first = bodies[firstIndex];
      const second = bodies[secondIndex];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = max(0.001, sqrt(dx * dx + dy * dy));
      const firstRadius = first.collisionRadius || radius;
      const secondRadius = second.collisionRadius || radius;
      const overlap = firstRadius + secondRadius + padding - distance;
      if (overlap <= 0) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      const firstInverseMass = 1 / max(1, first.weight);
      const secondInverseMass = 1 / max(1, second.weight);
      const inverseMassTotal = firstInverseMass + secondInverseMass;
      const firstShare = firstInverseMass / inverseMassTotal;
      const secondShare = secondInverseMass / inverseMassTotal;
      first.x -= nx * overlap * firstShare;
      first.y -= ny * overlap * firstShare;
      second.x += nx * overlap * secondShare;
      second.y += ny * overlap * secondShare;

      const relativeVelocity = (second.vx - first.vx) * nx + (second.vy - first.vy) * ny;
      if (relativeVelocity >= 0) continue;

      const restitution = 0.2;
      const impulse = -(1 + restitution) * relativeVelocity / inverseMassTotal;
      first.vx -= nx * impulse * firstInverseMass;
      first.vy -= ny * impulse * firstInverseMass;
      second.vx += nx * impulse * secondInverseMass;
      second.vy += ny * impulse * secondInverseMass;
      const spin = nx * impulse * 0.018;
      first.angularVelocity = constrain(
        first.angularVelocity - spin * firstInverseMass,
        -10,
        10
      );
      second.angularVelocity = constrain(
        second.angularVelocity + spin * secondInverseMass,
        -10,
        10
      );
    }
  }
}

function applyLogoPreset() {
  const layout = state.logoLayout || 'horizontal';
  const oneTimeText = state.logoVariant === 'text' && state.textRepeat === false;
  const amount = oneTimeText
    ? textCharacters(state).length
    : layout === 'single' ? 1 : 2;
  const grid = gridMetrics(state.gridSize);
  const centerCol = floor(grid.cols / 2);
  const centerRow = floor(grid.rows / 2);

  state.mode = 'logo';
  state.logoLayout = layout;
  state.logos = oneTimeText
    ? Array.from({ length: amount }, (_, index) => {
        const col = centerCol - floor(amount / 2) + index;
        return { col, row: centerRow, rotation: cellRotation(col, centerRow) };
      })
    : amount === 1
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
  assignTextCharacters(state, state.logos, grid);

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
      // Keep the checker field anchored to the visual centre. Its parity must
      // not flip merely because zoom changes the number of surrounding cells.
      if ((row - centerRow + col - centerCol) % 2 === 0) {
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
  const source = cloneState(state);
  const targetIndex = Number(document.getElementById('keyframe-list').value || selectedKeyframe);
  if (!keyframes[targetIndex]) return;
  selectedKeyframe = targetIndex;
  state = cloneState(keyframes[selectedKeyframe]);
  const previewDuration = keyframeAnimationDuration(selectedKeyframe);
  keyframePreviewTransition = {
    source: { ...source, duration: 100, animationDuration: 100 },
    target: keyframes[selectedKeyframe],
    start: millis(),
    duration: previewDuration
  };
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

function keyframePreviewState(elapsed) {
  const preview = keyframePreviewTransition;
  if (!preview) return state;
  const savedKeyframes = keyframes;
  keyframes = [preview.source, preview.target];
  try {
    return playbackState(100 + min(elapsed, preview.duration));
  } finally {
    keyframes = savedKeyframes;
  }
}

function syncControls() {
  document.getElementById('mode').value = state.mode || 'pattern';
  syncOptionButtons();
  syncZoomControl();
  document.getElementById('show-grid').checked = state.showGrid;
  document.getElementById('focus-logo').checked = Boolean(state.focusOnLogo);
  document.getElementById('logo-variant').value = state.logoVariant || 'original';
  document.getElementById('logo-text').value = state.logoText || 'NOORDZUID';
  document.getElementById('text-once').checked = state.textRepeat === false;
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
  keyframePreviewTransition = null;
  lastPlaybackFallState = null;
  fallReturnTransition = null;
  playbackFallActive = false;
  playbackFallLayoutKey = null;

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
  playbackFallLayoutKey = null;
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

function centeredGridCell(logo, grid) {
  const position = centeredGridPosition(logo, grid);
  return {
    col: round(position.col),
    row: round(position.row)
  };
}

function centeredGridPosition(logo, grid) {
  return {
    col: logo.col - (grid.cols - 1) / 2,
    row: logo.row - (grid.rows - 1) / 2
  };
}

function logoFromCenteredPosition(logo, position, grid) {
  return {
    ...logo,
    col: position.col + (grid.cols - 1) / 2,
    row: position.row + (grid.rows - 1) / 2
  };
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

  // Every keyframe change uses the local envelope system. The planner keeps
  // only exact matches still and reserves a direct roll for one-cell moves.
  return simpleEnvelopeTransitionPlan(
    from,
    to,
    transitionGrid,
    frameLength,
    animationLength,
    transitionStagger
  );

  /* Legacy multi-cell logo routing is intentionally bypassed. */
  const positions = from.logos.map(logo => ({ ...logo }));
  const pairCandidates = [];
  const usedSources = new Set();
  const usedTargets = new Set();
  const items = [];

  // A pure zoom changes absolute row/column indices while keeping the same
  // centre-relative cells. Hold those marks in place instead of routing them
  // out and back in. This also applies in the tracked logo mode.
  from.logos.forEach((logo, sourceIndex) => {
    const sourceCell = centeredGridCell(logo, fromGrid);
    const targetIndex = to.logos.findIndex((target, index) => {
      if (usedTargets.has(index)) return false;
      const targetCell = centeredGridCell(target, toGrid);
      return targetCell.col === sourceCell.col && targetCell.row === sourceCell.row &&
        logosShareContent(from, to, sourceIndex, index);
    });
    if (targetIndex < 0) return;

    usedSources.add(sourceIndex);
    usedTargets.add(targetIndex);
    items.push({
      kind: 'hold',
      logoIndex: sourceIndex,
      targetIndex,
      path: [{ ...logo }],
      weight: 0
    });
  });

  from.logos.forEach((source, sourceIndex) => {
    if (usedSources.has(sourceIndex)) return;
    to.logos.forEach((target, targetIndex) => {
      if (usedTargets.has(targetIndex)) return;
      if (!logosShareContent(from, to, sourceIndex, targetIndex)) return;
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

function simpleEnvelopeTransitionPlan(
  from,
  to,
  grid,
  frameLength,
  animationLength,
  transitionStagger
) {
  const items = [];
  const usedSources = new Set();
  const usedTargets = new Set();
  const fromGrid = gridMetrics(from.gridSize);
  const toGrid = gridMetrics(to.gridSize);

  // Keep only genuinely identical marks still. Centre-relative coordinates
  // make this stable while the grid itself zooms.
  from.logos.forEach((logo, logoIndex) => {
    const sourceCell = centeredGridCell(logo, fromGrid);
    const targetIndex = to.logos.findIndex((target, index) => {
      if (usedTargets.has(index)) return false;
      const targetCell = centeredGridCell(target, toGrid);
      return targetCell.col === sourceCell.col && targetCell.row === sourceCell.row &&
        logosExactlyMatch(from, to, logoIndex, index);
    });
    if (targetIndex < 0) return;

    // Identical content must not acquire a generated rotation merely because
    // the grid or pattern was rebuilt for another keyframe.
    to.logos[targetIndex].rotation = logo.rotation;
    usedSources.add(logoIndex);
    usedTargets.add(targetIndex);
    items.push({
      kind: 'hold',
      logoIndex,
      targetIndex,
      path: [{ ...logo }],
      weight: 0
    });
  });

  // The logo preset has one deliberate exception to the envelope rule. When
  // switching from side-by-side to stacked, the displaced mark follows the
  // free corner around the held centre mark in exactly two quarter-turns.
  if (
    from.mode === 'logo' && to.mode === 'logo' &&
    from.logoLayout === 'horizontal' && to.logoLayout === 'vertical'
  ) {
    from.logos.forEach((logo, logoIndex) => {
      if (usedSources.has(logoIndex)) return;
      const sourceCell = centeredGridCell(logo, fromGrid);
      const targetIndex = to.logos.findIndex((target, index) => {
        if (usedTargets.has(index)) return false;
        if (!logosShareContent(from, to, logoIndex, index)) return false;
        const targetCell = centeredGridCell(target, toGrid);
        return abs(sourceCell.col - targetCell.col) +
          abs(sourceCell.row - targetCell.row) === 2;
      });
      if (targetIndex < 0) return;

      const target = to.logos[targetIndex];
      const targetPosition = centeredGridPosition(target, toGrid);
      const pathTarget = logoFromCenteredPosition(target, targetPosition, fromGrid);
      const corner = {
        ...logo,
        row: pathTarget.row
      };
      corner.rotation = logo.rotation + anchoredTurn(logo, corner);
      pathTarget.rotation = corner.rotation + anchoredTurn(corner, pathTarget);
      to.logos[targetIndex].rotation = pathTarget.rotation;
      usedSources.add(logoIndex);
      usedTargets.add(targetIndex);
      items.push({
        kind: 'route',
        logoIndex,
        targetIndex,
        path: [{ ...logo }, corner, pathTarget],
        weight: 2
      });
    });
  }

  // A matching mark exactly one cell away keeps its natural single roll.
  // Longer moves deliberately become an envelope exit plus envelope entry.
  const oneStepCandidates = [];
  from.logos.forEach((logo, logoIndex) => {
    if (usedSources.has(logoIndex)) return;
    const sourceCell = centeredGridCell(logo, fromGrid);
    to.logos.forEach((target, targetIndex) => {
      if (usedTargets.has(targetIndex)) return;
      if (!logosShareContent(from, to, logoIndex, targetIndex)) return;
      const targetCell = centeredGridCell(target, toGrid);
      const distance = abs(sourceCell.col - targetCell.col) +
        abs(sourceCell.row - targetCell.row);
      if (distance !== 1) return;
      oneStepCandidates.push({
        logoIndex,
        targetIndex,
        indexDistance: abs(logoIndex - targetIndex)
      });
    });
  });

  oneStepCandidates.sort((a, b) => a.indexDistance - b.indexDistance);
  oneStepCandidates.forEach(({ logoIndex, targetIndex }) => {
    if (usedSources.has(logoIndex) || usedTargets.has(targetIndex)) return;
    const logo = from.logos[logoIndex];
    const target = to.logos[targetIndex];
    const targetPosition = centeredGridPosition(target, toGrid);
    const pathTarget = logoFromCenteredPosition(target, targetPosition, fromGrid);
    pathTarget.rotation = logo.rotation + anchoredTurn(logo, pathTarget);
    // Preserve the completed physical roll in the target keyframe so playback
    // and manual keyframe previews cannot snap to an older target rotation.
    to.logos[targetIndex].rotation = pathTarget.rotation;
    usedSources.add(logoIndex);
    usedTargets.add(targetIndex);
    items.push({
      kind: 'step',
      logoIndex,
      targetIndex,
      path: [{ ...logo }, pathTarget],
      weight: 1
    });
  });

  from.logos.forEach((logo, logoIndex) => {
    if (usedSources.has(logoIndex)) return;

    const direction = ENVELOPE_DIRECTION;
    const targetCell = {
      col: logo.col + direction.col,
      row: logo.row + direction.row
    };
    items.push({
      kind: 'exit',
      logoIndex,
      path: [{ ...logo }, {
        ...targetCell,
        rotation: logo.rotation + anchoredTurn(logo, targetCell)
      }],
      weight: 1,
      envelope: {
        kind: 'exit',
        col: logo.col,
        row: logo.row,
        direction
      }
    });
  });

  to.logos.forEach((logo, targetIndex) => {
    if (usedTargets.has(targetIndex)) return;

    const direction = ENVELOPE_DIRECTION;
    const start = {
      col: logo.col - direction.col,
      row: logo.row - direction.row
    };
    items.push({
      kind: 'enter',
      targetIndex,
      path: [{
        ...start,
        rotation: logo.rotation - anchoredTurn(start, logo)
      }, { ...logo }],
      weight: 1,
      envelope: {
        kind: 'enter',
        col: logo.col,
        row: logo.row,
        direction
      }
    });
  });

  // Stagger remains available, but there are no collision reservations or
  // chained routes anymore: every moving mark performs exactly one roll.
  const movingItems = items.filter(item => item.weight > 0);
  const lastStart = max(0, movingItems.length - 1) * transitionStagger;
  movingItems.forEach((item, index) => {
    item.start = index * transitionStagger * animationLength /
      max(1, 1 + lastStart);
    item.duration = animationLength / max(1, 1 + lastStart);
  });

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
  const direction = ENVELOPE_DIRECTION;
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

// After fallen content has cleared the bottom edge, only the target marks use
// the envelope transition. The fallen marks never roll back onto the grid.
function fallReturnItems(_source, target) {
  const items = [];

  target.logos.forEach((logo, targetIndex) => {
    const direction = ENVELOPE_DIRECTION;
    const start = {
      col: logo.col - direction.col,
      row: logo.row - direction.row
    };
    items.push({
      kind: 'enter',
      targetIndex,
      path: [{
        ...start,
        rotation: logo.rotation - anchoredTurn(start, logo)
      }, { ...logo }],
      envelope: {
        kind: 'enter',
        col: logo.col,
        row: logo.row,
        direction
      }
    });
  });

  return items;
}

function fallReturnState(transition, target, elapsed, duration) {
  const raw = constrain(elapsed / max(1, duration), 0, 1);
  const source = transition.source;
  const easing = target.easing || easingType;
  const leaving = raw < 0.5;
  const phaseProgress = leaving ? raw * 2 : (raw - 0.5) * 2;
  const enterProgress = constrain(applyEasing(phaseProgress, easing), 0, 1);
  const styleSource = leaving ? source : target;
  const result = {
    ...cloneState(styleSource),
    fall: false,
    noiseRunning: false,
    gridSize: leaving
      ? source.gridSize
      : lerp(source.gridSize, target.gridSize, enterProgress),
    foreground: lerpColor(color(source.foreground), color(target.foreground), raw).toString('#rrggbb'),
    background: lerpColor(color(source.background), color(target.background), raw).toString('#rrggbb'),
    viewFocus: 0,
    viewOffset: leaving ? logoGridOffset(source) : logoGridOffset(target)
  };
  const grid = gridMetrics(result.gridSize);
  result.gridOrigin = { left: grid.left, top: grid.top };

  // Keep advancing the exact same fall simulation for the full transition.
  // Individual marks remain in the render list until their complete rotated
  // bounds have crossed the bottom edge; the halfway phase change may never
  // make still-visible text disappear.
  if (!transition.bodies) transition.bodies = createFallBodies(source);
  const departingPoses = stepFallBodies(source, {
    bodies: transition.bodies,
    allowBottomExit: true,
    clock: transition
  });
  const sourceGrid = gridMetrics(source.gridSize);
  const sourceView = viewGridMetrics({
    ...source,
    viewFocus: 0,
    viewOffset: logoGridOffset(source)
  });
  const resultView = viewGridMetrics(result);
  const sourceViewportLeft = sourceGrid.left - sourceView.left;
  const sourceViewportTop = sourceGrid.top - sourceView.top;
  const departingLogos = departingPoses.flatMap((logo, index) => {
    const body = transition.bodies[index];
    const angle = radians(body.rotation);
    const extent = sourceGrid.cell * (body.renderScale || 1) * 0.5 *
      (abs(cos(angle)) + abs(sin(angle))) + 3;
    const screenPosition = {
      x: body.x - sourceViewportLeft,
      y: body.y - sourceViewportTop
    };
    if (screenPosition.y - extent >= height) return [];
    const glyphIndex = logo.glyphIndex ?? index;
    return [{
      ...logo,
      ...canvasPointToLogo(screenPosition, logo.rotation, resultView),
      textCharacter: logo.textCharacter ?? textCharacterAt(source, glyphIndex),
      styleVariant: logo.styleVariant || logoStyleAt(source, glyphIndex)
    }];
  });
  transition.complete = raw >= 1 && departingLogos.length === 0;

  if (leaving) {
    result.logos = departingLogos;
    return result;
  }

  const enteringLogos = [];
  const transitionStagger = constrain(Number(target.stagger ?? stagger), 0, 1);
  const lastStart = max(0, transition.items.length - 1) * transitionStagger;
  const phaseDuration = duration * 0.5;
  const itemDuration = phaseDuration / max(1, 1 + lastStart);
  const transitionElapsed = enterProgress * phaseDuration;

  transition.items.forEach((item, index) => {
    const itemStart = index * transitionStagger * itemDuration;
    const itemProgress = constrain(
      (transitionElapsed - itemStart) / max(1, itemDuration),
      0,
      1
    );
    const poseSource = target.logos[item.targetIndex];
    const targetGrid = gridMetrics(target.gridSize);
    const referencePose = rollPathPose(
      item.path,
      itemProgress,
      target.gridSize,
      easing
    );
    const currentPose = logoFromCenteredPosition(
      referencePose,
      centeredGridPosition(referencePose, targetGrid),
      grid
    );
    const envelopePosition = centeredGridPosition(item.envelope, targetGrid);
    const currentEnvelope = logoFromCenteredPosition(
      item.envelope,
      envelopePosition,
      grid
    );
    const pose = {
      ...poseSource,
      ...currentPose,
      transitionEnvelope: {
        ...item.envelope,
        col: currentEnvelope.col,
        row: currentEnvelope.row
      }
    };
    const settledRotation = target.logos[item.targetIndex].rotation;
    pose.textRotation = pose.rotation - settledRotation;
    pose.textCharacter = textCharacterAt(target, item.targetIndex);
    pose.styleVariant = logoStyleAt(target, item.targetIndex);
    enteringLogos.push({ ...pose, glyphIndex: item.targetIndex });
  });
  result.logos = [...departingLogos, ...enteringLogos];
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
    if (
      fallReturnTransition?.segment === segment &&
      !fallReturnTransition.complete
    ) break;
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
  const currentGridSize = lerp(from.gridSize, to.gridSize, colorProgress);
  const currentGrid = gridMetrics(currentGridSize);

  // Freeze the actual fallen pose once. It first clears the bottom edge; only
  // after that does the next layout enter through its envelopes.
  if (isFalling(from) && !isFalling(to)) {
    if (!fallReturnTransition || fallReturnTransition.segment !== segment) {
      const fallen = cloneState(lastPlaybackFallState || from);
      const departingBodies = fallBodies.map(body => ({
        ...body,
        bounds: { ...body.bounds }
      }));
      fallReturnTransition = {
        segment,
        source: fallen,
        items: fallReturnItems(fallen, to),
        bodies: departingBodies.length ? departingBodies : createFallBodies(fallen),
        lastFallUpdate: millis()
      };
    }
    return fallReturnState(fallReturnTransition, to, segmentElapsed, plan.animationDuration);
  }

  // Consecutive fall keyframes share their in-flight bodies, but the requested
  // layout is still allowed to change. At the midpoint the physics runtime
  // reconciles its body count and glyph/style metadata with the new keyframe
  // without resetting the bodies that remain.
  if (isFalling(from) && isFalling(to)) {
    const layoutSource = raw < 0.5 ? from : to;
    const fallState = cloneState(layoutSource);
    Object.assign(fallState, transitionViewport(from, to, colorProgress));
    fallState.fall = true;
    fallState.gridSize = currentGridSize;
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
    fallState.logos = layoutSource.logos.map(logo => ({ ...logo }));
    return fallState;
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

    if (item.kind === 'hold') {
      const sourceLogo = from.logos[item.logoIndex];
      const targetLogo = to.logos[item.targetIndex];
      const sourcePosition = centeredGridPosition(
        sourceLogo,
        gridMetrics(from.gridSize)
      );
      const targetPosition = centeredGridPosition(
        targetLogo,
        gridMetrics(to.gridSize)
      );
      const heldLogo = logoFromCenteredPosition({
        ...(raw < 0.5 ? sourceLogo : targetLogo),
        rotation: lerp(sourceLogo.rotation, targetLogo.rotation, colorProgress),
        textCharacter: textCharacterAt(from, item.logoIndex)
      }, {
        col: lerp(sourcePosition.col, targetPosition.col, colorProgress),
        row: lerp(sourcePosition.row, targetPosition.row, colorProgress)
      }, currentGrid);
      logos[item.logoIndex] = heldLogo;
      sourceFocusLogos.push(heldLogo);
      targetFocusLogos.push(heldLogo);
      return;
    }

    const poseSource = item.kind === 'enter'
      ? to.logos[item.targetIndex]
      : from.logos[item.logoIndex];
    const referenceGrid = item.kind === 'enter'
      ? gridMetrics(to.gridSize)
      : gridMetrics(from.gridSize);
    const referenceSize = item.kind === 'enter'
      ? to.gridSize
      : from.gridSize;
    const referencePose = rollPathPose(
      item.path,
      progress,
      referenceSize,
      transitionEasing
    );
    const centredPose = centeredGridPosition(referencePose, referenceGrid);
    const currentPose = logoFromCenteredPosition(referencePose, centredPose, currentGrid);
    let transitionEnvelope;
    if (item.envelope) {
      const envelopePosition = centeredGridPosition(item.envelope, referenceGrid);
      const currentEnvelope = logoFromCenteredPosition(
        item.envelope,
        envelopePosition,
        currentGrid
      );
      transitionEnvelope = {
        ...item.envelope,
        col: currentEnvelope.col,
        row: currentEnvelope.row
      };
    }
    const pose = {
      ...poseSource,
      ...currentPose,
      transitionEnvelope
    };
    const settledRotation = item.kind === 'enter'
      ? to.logos[item.targetIndex].rotation
      : from.logos[item.logoIndex].rotation;
    if (item.kind === 'step' && logoStyleAt(from, item.logoIndex) === 'text') {
      const totalTurn = item.path[item.path.length - 1].rotation - item.path[0].rotation;
      pose.textRotation = sin(PI * progress) * totalTurn;
    } else {
      pose.textRotation = currentPose.rotation - settledRotation;
    }
    pose.textCharacter = item.kind === 'enter'
      ? textCharacterAt(to, item.targetIndex)
      : textCharacterAt(from, item.logoIndex);
    pose.styleVariant = item.kind === 'enter'
      ? logoStyleAt(to, item.targetIndex)
      : logoStyleAt(from, item.logoIndex);

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
    gridSize: currentGridSize,
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
  const newWidth = constrain(Number(document.getElementById('canvas-width').value) || 600, 200, 6000);
  const newHeight = constrain(Number(document.getElementById('canvas-height').value) || 600, 200, 6000);
  if (newWidth === width && newHeight === height) return;
  const scale = min(newWidth / width, newHeight / height);
  // Every frame has its own zoom/layout. Capture each grid before resizing so
  // manual/logo layouts keep their position and procedural patterns can be
  // rebuilt across every cell of the resized canvas.
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
    const repositionedLogos = source.logos.map(reposition);
    const repositionedPreFallLogos = source.preFallLogos?.map(reposition);
    const keepLiveFallPose = source === state && isFalling(source);

    if (source.mode === 'pattern' && !keepLiveFallPose) {
      source.logos = patternLogosFor(source, newGrid, repositionedLogos);
    } else if (source.mode === 'noise' && !keepLiveFallPose) {
      source.logos = noiseLogosFor(source, newGrid, repositionedLogos);
    } else {
      source.logos = repositionedLogos;
    }

    if (source.preFallLogos) {
      if (source.mode === 'pattern') {
        source.preFallLogos = patternLogosFor(source, newGrid, repositionedPreFallLogos);
      } else if (source.mode === 'noise') {
        source.preFallLogos = noiseLogosFor(source, newGrid, repositionedPreFallLogos);
      } else {
        source.preFallLogos = repositionedPreFallLogos;
      }
    }
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
