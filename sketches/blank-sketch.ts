import type p5 from 'p5';

export const sketchParameters = {
  backgroundColor: { type: 'color', label: 'Achtergrondkleur', default: '#000000' },
  speed: { type: 'range', label: 'Snelheid', min: 0, max: 10, step: 0.1, default: 1 },
} as const;

export type sketchValues = {
  backgroundColor: string;
  speed: number;
};

export function sketch(p: p5, host: HTMLDivElement, getValues: () => sketchValues) { //setup
  p.setup = () => {
    const canvas = p.createCanvas(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    canvas.attribute('aria-hidden', 'true');
    p.pixelDensity(1);
    // p.noLoop();
    p.background(getValues().backgroundColor);
  };
}

export function redrawSketch(p: p5, host: HTMLDivElement, values: sketchValues) { //draw
  p.resizeCanvas(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
  p.background(values.backgroundColor);

  p.fill(255);
  p.translate(p.width/2,p.height/2);
  p.rotate(p.frameCount * 0.01);
  p.rect(0,0,50,50);
}
