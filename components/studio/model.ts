export const GRID_ROWS = 10;
export const GRID_MARGIN_RATIO = 0.1;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

export const sketchParameters = {
  backgroundColor: { type: 'color', label: 'Achtergrondkleur', default: '#ffffff' },
  speed: { type: 'range', label: 'Snelheid', min: 0, max: 10, step: 0.1, default: 1 },
} as const;

export type ContentType = 'sketch' | 'image' | 'video';
export type FitMode = 'cover' | 'contain';
export type GridRect = { x: number; y: number; w: number; h: number };
export type SketchValues = { backgroundColor: string; speed: number };
export type BentoBox = GridRect & {
  id: string;
  contentType: ContentType;
  radius: number;
  zoom: number;
  positionX: number;
  positionY: number;
  fit: FitMode;
  fileName?: string;
  objectUrl?: string;
  sketchParameters: SketchValues;
};
export type Project = { name: string; width: number; height: number; background: string; fps: number; duration: number };
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
  name: 'Untitled composition', width: 1920, height: 1080, background: '#ffffff', fps: 30, duration: 10,
};

export const createBox = (rect: GridRect, contentType: ContentType = 'sketch'): BentoBox => ({
  id: crypto.randomUUID(), ...rect, contentType, radius: 24, zoom: 1, positionX: 0, positionY: 0, fit: 'cover',
  sketchParameters: { backgroundColor: sketchParameters.backgroundColor.default, speed: sketchParameters.speed.default },
});

export const initialBox: BentoBox = {
  id: 'sketch-01', x: 0, y: 0, w: 6, h: 4, contentType: 'sketch', radius: 24, zoom: 1,
  positionX: 0, positionY: 0, fit: 'cover', sketchParameters: { backgroundColor: '#ffffff', speed: 1 },
};

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
  const unit = project.height / GRID_ROWS;
  const margin = unit * GRID_MARGIN_RATIO;
  const columns = Math.max(1, Math.floor(project.width / unit));
  return { unit, margin, columns };
}

export function gridRectToProject(rect: GridRect, unit: number, margin: number) {
  return { x: rect.x * unit + margin / 2, y: rect.y * unit + margin / 2, width: rect.w * unit - margin, height: rect.h * unit - margin };
}

export function boxStyle(rect: GridRect, unit: number, margin: number, scale: number) {
  const result = gridRectToProject(rect, unit, margin);
  return { left: result.x * scale, top: result.y * scale, width: result.width * scale, height: result.height * scale };
}

export function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

export function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
