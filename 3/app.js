import { DEFAULT_STATE, PALETTE, makeLogoOptions } from "./constants.js";
import { Scene } from "./scene.js";
import { exportMp4, exportPng } from "./exporter.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const cloneState = () => ({
  ...DEFAULT_STATE,
  excludedColors: new Set(DEFAULT_STATE.excludedColors),
  confetti: { ...DEFAULT_STATE.confetti },
  polonaise: { ...DEFAULT_STATE.polonaise, linePositions: [...DEFAULT_STATE.polonaise.linePositions], lineOffsets: [...DEFAULT_STATE.polonaise.lineOffsets] },
  party: { ...DEFAULT_STATE.party },
});

const state = cloneState();
const canvas = $("#artboard");
const scene = new Scene(canvas, state);
let toastTimer;
let resizeTimer;
let extraConfettiRepeatTimer;
let extraConfettiPointerPosition = null;
const history = [];

function snapshotState() {
  return {
    mode: state.mode, foreground: state.foreground, background: state.background, varyColors: state.varyColors,
    excludedColors: [...state.excludedColors], contentScale: state.contentScale,
    width: state.width, height: state.height,
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
  state.mode = snapshot.mode; state.foreground = snapshot.foreground; state.background = snapshot.background;
  state.varyColors = snapshot.varyColors ?? true;
  state.excludedColors = new Set(snapshot.excludedColors); state.contentScale = snapshot.contentScale;
  state.width = snapshot.width; state.height = snapshot.height;
  Object.assign(state.confetti, snapshot.confetti);
  Object.assign(state.polonaise, snapshot.polonaise, { linePositions: [...snapshot.polonaise.linePositions], lineOffsets: [...snapshot.polonaise.lineOffsets] });
  Object.assign(state.party, snapshot.party);
  syncControlsFromState();
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
  state.mode = mode;
  $$(".mode-button").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === mode));
  $$(".mode-panel").forEach((panel) => { panel.hidden = panel.dataset.panel !== mode; });
  canvas.style.cursor = mode === "confetti" ? "crosshair" : mode === "polonaise" ? "grab" : "default";
  const canvasControls = $("#canvasControls");
  const secondaryControl = $("#canvasControlSecondary");
  canvasControls.hidden = mode === "party";
  if (mode === "confetti") {
    $("#canvasControlButton").textContent = "LMB";
    $("#canvasControlAction").textContent = "Explosie";
    secondaryControl.hidden = false;
  } else if (mode === "polonaise") {
    $("#canvasControlButton").textContent = "RMB";
    $("#canvasControlAction").textContent = "Backstep";
    secondaryControl.hidden = true;
  }
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

function renderPalette(target, selector) {
  const palette = $(selector);
  palette.replaceChildren();
  for (const color of PALETTE) {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.background = color;
    const canExclude = exclusionsEnabled();
    const isExcluded = canExclude && state.excludedColors.has(color);
    const exclusionLabel = isExcluded ? ", uitgesloten voor kleurvariatie" : "";
    swatch.title = `${color}${isExcluded ? " · niet in kleurvariatie" : ""}`;
    swatch.setAttribute("aria-label", `Kleur ${color}${exclusionLabel}`);
    swatch.classList.toggle("is-selected", color === state[target]);
    swatch.classList.toggle("is-excluded", isExcluded);
    swatch.addEventListener("click", () => {
      state[target] = color;
      scene.tintCache.clear();
      scene.recolorStrokes();
      scene.recolorParty();
      updateColorControls();
    });
    if (canExclude) {
      swatch.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (state.excludedColors.has(color)) state.excludedColors.delete(color); else state.excludedColors.add(color);
        scene.recolorStrokes();
        scene.recolorParty();
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
  $("#contentScale").value = Math.round(state.contentScale * 100); $("#contentScaleOutput").value = `${Math.round(state.contentScale * 100)}%`;
  $("#canvasWidth").value = state.width; $("#canvasHeight").value = state.height;
  $$("input[type='range']").forEach(updateRange);
  updateColorControls(); setMode(state.mode); updateDimensions();
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / bounds.width) * state.width,
    y: ((event.clientY - bounds.top) / bounds.height) * state.height,
  };
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
    scene.recolorStrokes();
    scene.recolorParty();
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

  $("#contentScale").addEventListener("input", (event) => {
    state.contentScale = Number(event.target.value) / 100; $("#contentScaleOutput").value = `${event.target.value}%`;
    if (state.mode === "confetti") scene.syncConfetti();
    if (state.mode === "party") scene.syncParty();
  });

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
  });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    const point = canvasPoint(event);
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
  bindControls(); updateColorControls(); updateExportControls(); updateFrameSize();
  new ResizeObserver(updateFrameSize).observe($("#canvasStage"));
  try { await scene.init(); } catch (error) { toast("Niet alle merkassets konden worden geladen."); console.error(error); }
}

start();
