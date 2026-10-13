import { DEFAULT_STATE, PALETTE, TEXT_POSITIONS, makeLogoOptions } from "./constants.js";
import { Scene } from "./scene.js";
import { exportMp4, exportPng } from "./exporter.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const COLOR_MODES = ["confetti", "polonaise", "party"];
const createModeScales = () => Object.fromEntries(COLOR_MODES.map((mode) => [mode, DEFAULT_STATE.contentScale]));
const createModeColorSettings = () => Object.fromEntries(COLOR_MODES.map((mode) => [mode, {
  foreground: DEFAULT_STATE.foreground,
  background: DEFAULT_STATE.background,
  varyColors: DEFAULT_STATE.varyColors,
  excludedColors: new Set(DEFAULT_STATE.excludedColors),
}]));
const cloneState = () => {
  const colorSettings = createModeColorSettings();
  const contentScales = createModeScales();
  const activeColors = colorSettings[DEFAULT_STATE.mode];
  return {
    ...DEFAULT_STATE,
    foreground: activeColors.foreground,
    background: activeColors.background,
    varyColors: activeColors.varyColors,
    excludedColors: activeColors.excludedColors,
    colorSettings,
    contentScales,
    textItems: DEFAULT_STATE.textItems.map((item) => ({ ...item })),
    confetti: { ...DEFAULT_STATE.confetti },
    polonaise: { ...DEFAULT_STATE.polonaise, linePositions: [...DEFAULT_STATE.polonaise.linePositions], lineOffsets: [...DEFAULT_STATE.polonaise.lineOffsets] },
    party: { ...DEFAULT_STATE.party },
  };
};

const state = cloneState();
const canvas = $("#artboard");
const scene = new Scene(canvas, state);
let toastTimer;
let resizeTimer;
let extraConfettiRepeatTimer;
let extraConfettiPointerPosition = null;
let activeTextId = null;
let nextTextId = 1;
const history = [];

function saveActiveModeSettings() {
  const colors = state.colorSettings[state.mode];
  colors.foreground = state.foreground;
  colors.background = state.background;
  colors.varyColors = state.varyColors;
  colors.excludedColors = state.excludedColors;
  state.contentScales[state.mode] = state.contentScale;
}

function loadModeSettings(mode) {
  const colors = state.colorSettings[mode];
  state.foreground = colors.foreground;
  state.background = colors.background;
  state.varyColors = colors.varyColors;
  state.excludedColors = colors.excludedColors;
  state.contentScale = state.contentScales[mode];
}

function serializeColorSettings() {
  saveActiveModeSettings();
  return Object.fromEntries(COLOR_MODES.map((mode) => {
    const colors = state.colorSettings[mode];
    return [mode, { ...colors, excludedColors: [...colors.excludedColors] }];
  }));
}

function restoreColorSettings(snapshot) {
  const defaults = createModeColorSettings();
  return Object.fromEntries(COLOR_MODES.map((mode) => {
    const colors = snapshot?.[mode];
    return [mode, colors ? { ...colors, excludedColors: new Set(colors.excludedColors) } : defaults[mode]];
  }));
}

function snapshotState() {
  return {
    mode: state.mode, colorSettings: serializeColorSettings(), contentScales: { ...state.contentScales },
    width: state.width, height: state.height,
    textItems: state.textItems.map((item) => ({ ...item })),
    confetti: { ...state.confetti },
    polonaise: { ...state.polonaise, linePositions: [...state.polonaise.linePositions], lineOffsets: [...state.polonaise.lineOffsets] },
    party: { ...state.party },
  };
}

function pushHistory() {
  const snapshot = snapshotState();
  const serialized = JSON.stringify(snapshot);
  if (history.at(-1)?.serialized === serialized) return;
  history.push({ snapshot, serialized });
  if (history.length > 50) history.shift();
}

function restoreSnapshot(snapshot) {
  state.mode = snapshot.mode;
  state.colorSettings = restoreColorSettings(snapshot.colorSettings);
  state.contentScales = { ...createModeScales(), ...snapshot.contentScales };
  loadModeSettings(state.mode);
  state.width = snapshot.width; state.height = snapshot.height;
  state.textItems = (snapshot.textItems || []).map((item) => ({ ...item }));
  Object.assign(state.confetti, snapshot.confetti);
  Object.assign(state.polonaise, snapshot.polonaise, { linePositions: [...snapshot.polonaise.linePositions], lineOffsets: [...snapshot.polonaise.lineOffsets] });
  Object.assign(state.party, snapshot.party);
  syncControlsFromState();
  closeTextMenu();
  scene.tintCache.clear(); scene.reset();
}

function undo() {
  const entry = history.pop();
  if (!entry) return;
  restoreSnapshot(entry.snapshot);
  toast("Ongedaan gemaakt");
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => element.classList.remove("is-visible"), 2800);
}

function updateFrameSize() {
  const stage = $("#canvasStage");
  const frame = $("#canvasFrame");
  const availableWidth = Math.max(80, stage.clientWidth - 52);
  const availableHeight = Math.max(80, stage.clientHeight - 52);
  const scale = Math.min(availableWidth / state.width, availableHeight / state.height, 1);
  frame.style.width = `${Math.max(1, Math.round(state.width * scale))}px`;
  frame.style.height = `${Math.max(1, Math.round(state.height * scale))}px`;
}

function updateDimensions() {
  const width = Math.max(100, Math.min(4096, Number($("#canvasWidth").value) || 1080));
  const height = Math.max(100, Math.min(4096, Number($("#canvasHeight").value) || 1920));
  state.width = Math.round(width); state.height = Math.round(height);
  $("#canvasWidth").value = state.width; $("#canvasHeight").value = state.height;
  scene.resize(state.width, state.height);
  updateFrameSize();
}

function updateRange(range) {
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const value = ((Number(range.value) - min) / (max - min)) * 100;
  range.style.setProperty("--fill", `${value}%`);
}

function setMode(mode) {
  saveActiveModeSettings();
  state.mode = mode;
  loadModeSettings(mode);
  $$(".mode-button").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  $$(".mode-panel").forEach((panel) => { panel.hidden = panel.dataset.panel !== mode; });
  canvas.style.cursor = mode === "confetti" ? "crosshair" : mode === "polonaise" ? "grab" : "default";
  const canvasControls = $("#canvasControls");
  const primaryControl = $("#canvasControlPrimary");
  const secondaryControl = $("#canvasControlSecondary");
  canvasControls.hidden = false;
  primaryControl.hidden = mode === "party";
  if (mode === "confetti") {
    $("#canvasControlButton").textContent = "LMB";
    $("#canvasControlAction").textContent = "Explosie";
    secondaryControl.hidden = false;
  } else if (mode === "polonaise") {
    $("#canvasControlButton").textContent = "RMB";
    $("#canvasControlAction").textContent = "Backstep";
    secondaryControl.hidden = true;
  } else {
    secondaryControl.hidden = true;
  }
  $("#varyColors").checked = state.varyColors;
  updateColorControls();
  scene.modeChanged();
}

function fillLogoSelect(select) {
  for (const option of makeLogoOptions()) select.add(new Option(option.label, option.id));
  select.value = "variation";
}

function exclusionsEnabled() {
  return state.varyColors;
}

function refreshActiveVariationColors() {
  if (state.mode === "confetti") scene.recolorStrokes();
  if (state.mode === "party") scene.recolorParty();
}

function renderPalette(target, selector) {
  const palette = $(selector);
  palette.replaceChildren();
  for (const color of PALETTE) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.background = color;
    const canExclude = exclusionsEnabled();
    const isAutomaticallyExcluded = state.mode === "confetti" && (color === state.foreground || color === state.background);
    const isExcluded = canExclude && (state.excludedColors.has(color) || isAutomaticallyExcluded);
    const exclusionLabel = isExcluded ? ", uitgesloten voor kleurvariatie" : "";
    swatch.title = `${color}${isExcluded ? " · niet in kleurvariatie" : ""}`;
    swatch.setAttribute("aria-label", `Kleur ${color}${exclusionLabel}`);
    swatch.classList.toggle("is-selected", color === state[target]);
    swatch.classList.toggle("is-excluded", isExcluded);
    swatch.addEventListener("click", () => {
      state[target] = color;
      scene.tintCache.clear();
      refreshActiveVariationColors();
      updateColorControls();
    });
    if (canExclude) {
      swatch.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (state.excludedColors.has(color)) state.excludedColors.delete(color); else state.excludedColors.add(color);
        refreshActiveVariationColors();
        updateColorControls();
      });
    }
    palette.append(swatch);
  }
}

function updateColorControls() {
  renderPalette("foreground", "#foregroundPalette");
  renderPalette("background", "#backgroundPalette");
}

function syncControlsFromState() {
  $("#confettiText").value = state.confetti.text;
  const confettiSizePosition = Math.max(0, Math.min(100, Math.round(((state.confetti.size - 1.8) / 3.2) * 100)));
  $("#confettiSize").value = confettiSizePosition; $("#confettiSizeOutput").value = `${confettiSizePosition}%`;
  $("#force").value = Math.round(state.confetti.force * 100); $("#forceOutput").value = `${Math.round(state.confetti.force * 100)}%`;
  $("#varyColors").checked = state.varyColors;
  $("#polonaiseLogo").value = state.polonaise.logo; $("#partyLogo").value = state.party.logo;
  $$("#directionGrid button").forEach((button) => button.classList.toggle("is-active", button.dataset.direction === state.polonaise.direction));
  $$("#alternatingControl button").forEach((button) => button.classList.toggle("is-active", (button.dataset.alternating === "true") === state.polonaise.alternating));
  $("#polonaiseSpeed").value = Math.round(state.polonaise.speed * 100); $("#polonaiseSpeedOutput").value = `${Math.round(state.polonaise.speed * 100)}%`;
  $("#polonaiseLineCount").value = state.polonaise.lineCount; $("#polonaiseLineCountOutput").value = state.polonaise.lineCount;
  $("#noise").value = Math.round(state.party.noise * 100); $("#noiseOutput").value = `${Math.round(state.party.noise * 100)}%`;
  $("#partyCount").value = state.party.count; $("#partyCountOutput").value = state.party.count;
  $("#partySpeed").value = Math.round(state.party.speed * 100); $("#partySpeedOutput").value = `${Math.round(state.party.speed * 100)}%`;
  $$(".content-scale").forEach((input) => {
    const value = Math.round(state.contentScales[input.dataset.mode] * 100);
    input.value = value;
    input.closest(".field").querySelector(".content-scale-output").value = `${value}%`;
  });
  $("#canvasWidth").value = state.width; $("#canvasHeight").value = state.height;
  $$("input[type='range']").forEach(updateRange);
  renderTextMenus();
  updateColorControls(); setMode(state.mode); updateDimensions();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * state.width,
    y: ((event.clientY - bounds.top) / bounds.height) * state.height,
  };
}

function activeTextItem() {
  return state.textItems.find((item) => item.id === activeTextId) || null;
}

function closeTextMenu() {
  activeTextId = null;
  $$("#textMenus .text-block").forEach((block) => { block.open = false; });
}

function renderTextMenus(focusText = false) {
  const section = $("#textSection");
  const menus = $("#textMenus");
  section.hidden = state.textItems.length === 0;
  menus.replaceChildren();

  for (const item of state.textItems) {
    const block = document.createElement("details");
    block.className = "text-block";
    block.dataset.textId = item.id;
    block.open = item.id === activeTextId;

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.className = "text-block-title";
    title.textContent = item.text.trim().split("\n")[0] || "Lege tekst";
    summary.append(title);

    const body = document.createElement("div");
    body.className = "text-block-body";
    body.innerHTML = `<label class="field field-text"><span>Tekst</span><textarea class="text-value" rows="2" maxlength="160" spellcheck="false"></textarea></label>
      <div class="text-block-row">
        <label class="field"><span><span>Grootte</span><output class="text-size-output"></output></span><input class="text-size" type="range" min="2" max="50" step="0.5" /></label>
        <label class="field"><span>Blendmodus</span><select class="text-blend-mode"><option value="difference">Difference</option><option value="normal">Normaal</option></select></label>
      </div>
      <div class="field"><span>Positie</span><div class="text-position-grid" role="group" aria-label="Tekstpositie"></div></div>
      <button class="text-delete" type="button">Verwijder tekst</button>`;

    const textValue = body.querySelector(".text-value");
    const textSize = body.querySelector(".text-size");
    const textSizeOutput = body.querySelector(".text-size-output");
    const blendMode = body.querySelector(".text-blend-mode");
    const positionGrid = body.querySelector(".text-position-grid");
    textValue.value = item.text;
    textSize.value = item.size;
    textSizeOutput.value = `${item.size}%`;
    blendMode.value = item.blendMode;
    updateRange(textSize);

    const occupied = new Set(state.textItems.filter((candidate) => candidate.id !== item.id).map((candidate) => candidate.position));
    for (const position of TEXT_POSITIONS) {
      const button = document.createElement("button");
      const active = position.id === item.position;
      button.type = "button";
      button.dataset.position = position.id;
      button.dataset.horizontal = position.horizontal;
      button.dataset.vertical = position.vertical;
      button.title = position.label;
      button.setAttribute("aria-label", position.label);
      button.classList.toggle("is-active", active);
      button.disabled = !active && occupied.has(position.id);
      button.addEventListener("click", () => {
        item.position = position.id;
        activeTextId = item.id;
        renderTextMenus();
      });
      positionGrid.append(button);
    }

    block.addEventListener("toggle", () => {
      if (!block.open) {
        if (activeTextId === item.id) activeTextId = null;
        return;
      }
      activeTextId = item.id;
      $$("#textMenus .text-block").forEach((other) => { if (other !== block) other.open = false; });
    });
    textValue.addEventListener("input", (event) => {
      item.text = event.target.value;
      title.textContent = item.text.trim().split("\n")[0] || "Lege tekst";
    });
    textSize.addEventListener("input", (event) => {
      item.size = Number(event.target.value);
      textSizeOutput.value = `${item.size}%`;
      updateRange(event.target);
    });
    blendMode.addEventListener("change", (event) => { item.blendMode = event.target.value; });
    body.querySelector(".text-delete").addEventListener("click", () => {
      state.textItems = state.textItems.filter((candidate) => candidate.id !== item.id);
      if (activeTextId === item.id) activeTextId = null;
      renderTextMenus();
      toast("Tekst verwijderd");
    });

    block.append(summary, body);
    menus.append(block);
  }

  const activeBlock = menus.querySelector(`[data-text-id="${activeTextId}"]`);
  if (activeBlock) {
    activeBlock.scrollIntoView({ block: "nearest" });
    if (focusText) {
      const input = activeBlock.querySelector(".text-value");
      input.focus();
      input.select();
    }
  }
}

function openTextMenu(id, recordHistory = true, focusText = false) {
  activeTextId = id;
  if (!activeTextItem()) return;
  if (recordHistory) pushHistory();
  renderTextMenus(focusText);
}

function addText() {
  const occupied = new Set(state.textItems.map((item) => item.position));
  const position = TEXT_POSITIONS.find((candidate) => !occupied.has(candidate.id));
  if (!position) return toast("Alle 9 tekstposities zijn bezet");
  pushHistory();
  const item = { id: nextTextId, text: "tekst", position: position.id, size: 6, blendMode: "difference" };
  nextTextId += 1;
  state.textItems.push(item);
  openTextMenu(item.id, false, true);
}

function bindControls() {
  fillLogoSelect($("#polonaiseLogo")); fillLogoSelect($("#partyLogo"));
  $$("input[type='range']").forEach((range) => { updateRange(range); range.addEventListener("input", () => updateRange(range)); });
  $$(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));

  $("#confettiText").addEventListener("input", (event) => {
    const lowercase = event.target.value.toLocaleLowerCase("nl");
    if (event.target.value !== lowercase) event.target.value = lowercase;
    state.confetti.text = lowercase; scene.syncConfetti();
  });
  $("#confettiSize").addEventListener("input", (event) => { state.confetti.size = 1.8 + (Number(event.target.value) / 100) * 3.2; $("#confettiSizeOutput").value = `${event.target.value}%`; scene.syncConfetti(); });
  $("#force").addEventListener("input", (event) => { state.confetti.force = Number(event.target.value) / 100; $("#forceOutput").value = `${event.target.value}%`; });
  $("#varyColors").addEventListener("change", (event) => {
    state.varyColors = event.target.checked;
    refreshActiveVariationColors();
    updateColorControls();
  });

  $("#polonaiseLogo").addEventListener("change", (event) => { state.polonaise.logo = event.target.value; });
  $("#partyLogo").addEventListener("change", (event) => { state.party.logo = event.target.value; scene.syncParty(); });
  $$("#directionGrid button").forEach((button) => button.addEventListener("click", () => {
    state.polonaise.direction = button.dataset.direction;
    $$("#directionGrid button").forEach((item) => item.classList.toggle("is-active", item === button));
  }));
  $$("#alternatingControl button").forEach((button) => button.addEventListener("click", () => {
    state.polonaise.alternating = button.dataset.alternating === "true";
    $$("#alternatingControl button").forEach((item) => item.classList.toggle("is-active", item === button));
  }));
  $("#polonaiseSpeed").addEventListener("input", (event) => { state.polonaise.speed = Number(event.target.value) / 100; $("#polonaiseSpeedOutput").value = `${event.target.value}%`; });
  $("#polonaiseLineCount").addEventListener("input", (event) => {
    const count = Number(event.target.value);
    $("#polonaiseLineCountOutput").value = count;
    scene.setPolonaiseLineCount(count);
  });
  $("#noise").addEventListener("input", (event) => { state.party.noise = Number(event.target.value) / 100; $("#noiseOutput").value = `${event.target.value}%`; });
  $("#partyCount").addEventListener("input", (event) => { state.party.count = Number(event.target.value); $("#partyCountOutput").value = event.target.value; scene.syncParty(); });
  $("#partySpeed").addEventListener("input", (event) => { state.party.speed = Number(event.target.value) / 100; $("#partySpeedOutput").value = `${event.target.value}%`; });

  $$(".content-scale").forEach((input) => input.addEventListener("input", (event) => {
    const mode = event.target.dataset.mode;
    const scale = Number(event.target.value) / 100;
    state.contentScales[mode] = scale;
    if (state.mode === mode) state.contentScale = scale;
    event.target.closest(".field").querySelector(".content-scale-output").value = `${event.target.value}%`;
    if (mode === "confetti") scene.syncConfetti();
    if (mode === "party") scene.syncParty();
  }));

  [$("#canvasWidth"), $("#canvasHeight")].forEach((input) => {
    input.addEventListener("change", updateDimensions);
    input.addEventListener("input", () => { window.clearTimeout(resizeTimer); resizeTimer = window.setTimeout(updateDimensions, 420); });
  });
  $("#swapDimensions").addEventListener("click", () => {
    const width = $("#canvasWidth").value; $("#canvasWidth").value = $("#canvasHeight").value; $("#canvasHeight").value = width; updateDimensions();
  });
  $("#exportFormat").addEventListener("change", updateExportControls);

  $(".panel").addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, input, select, textarea") && !event.target.closest("#exportButton")) pushHistory();
  }, true);
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
    const editable = event.target.closest?.("input, textarea, select, [contenteditable='true']");
    if (!editable && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLocaleLowerCase() === "t") { event.preventDefault(); addText(); }
    if (event.key === "Escape" && activeTextId !== null) closeTextMenu();
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const point = canvasPoint(event);
    const textId = scene.hitTestText(point.x, point.y);
    if (textId !== null) openTextMenu(textId);
    else closeTextMenu();
  });
  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event);
    if (event.button === 2 && scene.hitTestText(point.x, point.y) !== null) return;
    if (state.mode === "polonaise") {
      if (event.button === 2) {
        scene.queuePolonaiseSidestep();
      } else if (event.button === 0) {
        pushHistory();
        if (scene.beginPolonaiseDrag(point.x, point.y)) {
          canvas.setPointerCapture(event.pointerId);
          canvas.style.cursor = "grabbing";
        }
      }
      return;
    }
    if (state.mode !== "confetti") return;
    if (event.button === 2) {
      canvas.setPointerCapture(event.pointerId);
      extraConfettiPointerPosition = point;
      scene.addStroke(point.x, point.y);
      window.clearInterval(extraConfettiRepeatTimer);
      extraConfettiRepeatTimer = window.setInterval(() => {
        if (extraConfettiPointerPosition) scene.addStroke(extraConfettiPointerPosition.x, extraConfettiPointerPosition.y);
      }, 115);
    } else if (event.button === 0) {
      canvas.setPointerCapture(event.pointerId);
      scene.pointer.down = true;
      scene.applyForce(point.x, point.y, 1);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);
    if (state.mode === "polonaise") {
      scene.dragPolonaiseLine(point.x, point.y);
      return;
    }
    if (state.mode !== "confetti") return;
    if (extraConfettiPointerPosition) extraConfettiPointerPosition = point;
    if (scene.pointer.down) scene.applyForce(point.x, point.y, 0.12);
  });
  window.addEventListener("pointerup", () => {
    scene.pointer.down = false; extraConfettiPointerPosition = null; window.clearInterval(extraConfettiRepeatTimer);
    scene.endPolonaiseDrag();
    if (state.mode === "polonaise") canvas.style.cursor = "grab";
  });
  $("#exportButton").addEventListener("click", handleExport);
}

function updateExportControls() {
  const format = $("#exportFormat").value;
  $("#exportButton span").textContent = `Exporteer ${format.toUpperCase()}`;
  $(".duration-field").style.opacity = format === "mp4" ? "1" : ".38";
  $("#exportDuration").disabled = format !== "mp4";
}

async function handleExport() {
  const button = $("#exportButton");
  const progress = $("#exportProgress");
  const bar = progress.querySelector("span");
  button.disabled = true;
  try {
    if ($("#exportFormat").value === "png") {
      await exportPng(canvas); toast("PNG geëxporteerd");
    } else {
      const duration = Math.max(1, Math.min(30, Number($("#exportDuration").value) || 6));
      progress.hidden = false; bar.style.width = "0%";
      await exportMp4(canvas, duration, (value) => { bar.style.width = `${value * 100}%`; });
      toast("MP4 geëxporteerd");
    }
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; window.setTimeout(() => { progress.hidden = true; }, 500); }
}

async function start() {
  bindControls(); syncControlsFromState(); updateExportControls();
  new ResizeObserver(updateFrameSize).observe($("#canvasStage"));
  try { await scene.init(); } catch (error) { toast("Niet alle merkassets konden worden geladen."); console.error(error); }
}

start();
