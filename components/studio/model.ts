import { sketchParameters, type sketchValues } from '@/sketches/blank-sketch';

export { sketchParameters };

export const GRID_COLUMNS = 8;
export const GRID_ROWS = 8;
export const GRID_MARGIN_RATIO = 0.1;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

export type ContentType = 'sketch' | 'image' | 'video';
export type FitMode = 'cover' | 'contain';
export type GridRect = { x: number; y: number; w: number; h: number };
export type SketchValues = sketchValues;
export type BentoBox = GridRect & {
  id: string;
  contentType: ContentType;
  radius: number;
  zoom: number;
  positionX: number;
  positionY: number;
  fit: FitMode;
  background: string;
  fileName?: string;
  objectUrl?: string;
  sketchParameters: SketchValues;
};
export type Project = { width: number; height: number; background: string; fps: number; duration: number };
export type Interaction = {
  id: string;
  mode: 'drag' | 'resize';
  handle?: 'nw' | 'ne' | 'sw' | 'se';
  startX: number;
  startY: number;
  startBox: GridRect;
  lastValid: GridRect;
};
export type Preview = GridRect & { valid: boolean; id: string };
export type MediaElement = HTMLImageElement | HTMLVideoElement;

export const initialProject: Project = {
  width: 1920, height: 1080, background: '#292a27', fps: 30, duration: 10,
};

export const createBox = (rect: GridRect, contentType: ContentType = 'sketch'): BentoBox => ({
  id: crypto.randomUUID(), ...rect, contentType, radius: 24, zoom: 1, positionX: 0, positionY: 0, fit: 'cover', background: '#000000',
  sketchParameters: { backgroundColor: sketchParameters.backgroundColor.default, speed: sketchParameters.speed.default },
});

export const initialBox: BentoBox = {
  id: 'sketch-01', x: 0, y: 0, w: GRID_COLUMNS, h: GRID_ROWS, contentType: 'sketch', radius: 0, zoom: 1,
  positionX: 0, positionY: 0, fit: 'cover', background: '#000000', sketchParameters: { backgroundColor: '#000000', speed: 1 },
};

export function presetLayout(count: number, columns: number): GridRect[] {
  const c = Math.max(1, Math.min(6, Math.round(count)));
  const halfX = Math.floor(columns / 2);
  const halfY = Math.floor(GRID_ROWS / 2);
  const thirdX = Math.floor(columns / 3);
  const twoThirdX = Math.floor((columns * 2) / 3);
  if (c === 1) return [{ x: 0, y: 0, w: columns, h: GRID_ROWS }];
  if (c === 2) return [{ x: 0, y: 0, w: halfX, h: GRID_ROWS }, { x: halfX, y: 0, w: columns - halfX, h: GRID_ROWS }];
  if (c === 3) return [{ x: 0, y: 0, w: twoThirdX, h: GRID_ROWS }, { x: twoThirdX, y: 0, w: columns - twoThirdX, h: halfY }, { x: twoThirdX, y: halfY, w: columns - twoThirdX, h: GRID_ROWS - halfY }];
  if (c === 4) return [{ x: 0, y: 0, w: halfX, h: halfY }, { x: halfX, y: 0, w: columns - halfX, h: halfY }, { x: 0, y: halfY, w: halfX, h: GRID_ROWS - halfY }, { x: halfX, y: halfY, w: columns - halfX, h: GRID_ROWS - halfY }];
  if (c === 5) return [{ x: 0, y: 0, w: twoThirdX, h: 5 }, { x: twoThirdX, y: 0, w: columns - twoThirdX, h: 2 }, { x: twoThirdX, y: 2, w: columns - twoThirdX, h: 3 }, { x: 0, y: 5, w: halfX, h: 3 }, { x: halfX, y: 5, w: columns - halfX, h: 3 }];
  return [0, 1, 2].flatMap((column) => {
    const x = column * thirdX;
    const width = column === 2 ? columns - x : thirdX;
    return [{ x, y: 0, w: width, h: halfY }, { x, y: halfY, w: width, h: GRID_ROWS - halfY }];
  });
}

export function collides(rect: GridRect, other: GridRect) {
  return rect.x < other.x + other.w && rect.x + rect.w > other.x && rect.y < other.y + other.h && rect.y + rect.h > other.y;
}

export function isRectValid(rect: GridRect, boxes: BentoBox[], columns: number, ignoreId?: string) {
  if (rect.w < 1 || rect.h < 1 || rect.x < 0 || rect.y < 0 || rect.x + rect.w > columns || rect.y + rect.h > GRID_ROWS) return false;
  return !boxes.some((box) => box.id !== ignoreId && collides(rect, box));
}

export function firstAvailable(boxes: BentoBox[], columns: number, w = 4, h = 3) {
  const widths = Array.from(new Set([Math.min(w, columns), Math.min(4, columns), Math.min(3, columns), Math.min(2, columns), 1]));
  const heights = Array.from(new Set([Math.min(h, GRID_ROWS), 3, 2, 1]));
  for (const boxH of heights) for (const boxW of widths) for (let y = 0; y <= GRID_ROWS - boxH; y += 1) {
    for (let x = 0; x <= columns - boxW; x += 1) {
      const rect = { x, y, w: boxW, h: boxH };
      if (isRectValid(rect, boxes, columns)) return rect;
    }
  }
  return null;
}

export function gridMetrics(project: Project) {
  const unitX = project.width / GRID_COLUMNS;
  const unitY = project.height / GRID_ROWS;
  const marginX = unitX * GRID_MARGIN_RATIO;
  const marginY = unitY * GRID_MARGIN_RATIO;
  return { unitX, unitY, marginX, marginY, columns: GRID_COLUMNS, rows: GRID_ROWS };
}

export type GridMetrics = ReturnType<typeof gridMetrics>;

export function gridRectToProject(rect: GridRect, metrics: GridMetrics) {
  const x = rect.x * metrics.unitX + (rect.x === 0 ? 0 : metrics.marginX / 2);
  const y = rect.y * metrics.unitY + (rect.y === 0 ? 0 : metrics.marginY / 2);
  const right = (rect.x + rect.w) * metrics.unitX - (rect.x + rect.w === metrics.columns ? 0 : metrics.marginX / 2);
  const bottom = (rect.y + rect.h) * metrics.unitY - (rect.y + rect.h === metrics.rows ? 0 : metrics.marginY / 2);
  return { x, y, width: right - x, height: bottom - y };
}

export function boxStyle(rect: GridRect, metrics: GridMetrics, scale: number) {
  const result = gridRectToProject(rect, metrics);
  return { left: result.x * scale, top: result.y * scale, width: result.width * scale, height: result.height * scale };
}

export function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
