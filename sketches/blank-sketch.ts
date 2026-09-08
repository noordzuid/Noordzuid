import type p5 from 'p5';

export const sketchParameters = {
  backgroundColor: { type: 'color', label: 'Achtergrondkleur', default: '#000000' },
  speed: { type: 'range', label: 'Snelheid', min: 0, max: 10, step: 0.1, default: 1 },
} as const;

export type sketchValues = {
  backgroundColor: string;
  speed: number;
};

function drawFrame(p: p5, values: sketchValues) {
  p.background(values.backgroundColor);
  p.push();
  p.translate(p.width / 2, p.height / 2);
  p.rotate(p.frameCount * 0.01 * values.speed);
  p.noStroke();
  p.fill(255);
  p.rectMode(p.CENTER);
  p.rect(0, 0, 50, 50);
  p.pop();
}

export function sketch(p: p5, host: HTMLDivElement, getValues: () => sketchValues, onCanvas?: (element: HTMLCanvasElement) => void) { //setup
  p.setup = () => {
    const canvas = p.createCanvas(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    canvas.attribute('aria-hidden', 'true');
    onCanvas?.(canvas.elt as HTMLCanvasElement);
    p.pixelDensity(1);
  };

  p.draw = () => drawFrame(p, getValues());
}

export function redrawSketch(p: p5, host: HTMLDivElement, values: sketchValues) { //draw
  p.resizeCanvas(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  drawFrame(p, values);
}
