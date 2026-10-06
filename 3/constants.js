export const PALETTE = [
  "#000000", "#F28EFF", "#353214", "#FF8D8C", "#DDAAFF",
  "#8BCAFF", "#D4F2AA", "#053530", "#FFFFFF",
];

export const LOGOS = [
  { id: "normaal", label: "Normaal", src: "assets/logos/logo-normaal.svg" },
  { id: "rondjes", label: "Rondjes", src: "assets/logos/logo-rondjes.svg" },
  { id: "korterondjes", label: "Korte rondjes", src: "assets/logos/logo-korterondjes.svg" },
  { id: "langerondjes", label: "Lange rondjes", src: "assets/logos/logo-langerondjes.svg" },
  { id: "streepjes", label: "Streepjes", src: "assets/logos/logo-streepjes.svg" },
  { id: "wave", label: "Wave", src: "assets/logos/logo-wave.svg" },
];

export const STROKES = LOGOS.map((logo) => ({
  ...logo,
  src: `assets/strokes/stroke-${logo.id}.png`,
}));

export const DEFAULT_STATE = {
  mode: "confetti",
  foreground: PALETTE[1],
  background: PALETTE[0],
  excludedColors: new Set(),
  contentScale: 1,
  width: 1080,
  height: 1920,
  confetti: { text: "noordzuid", size: 2.5, force: 0.15, randomStrokeColors: true },
  polonaise: { logo: "variation", direction: "right", alternating: false, noise: 0.0, lineCount: 3, linePositions: [0.25, 0.5, 0.75], lineOffsets: [0, 0, 0], speed: 1 },
  party: { logo: "variation", noise: 0.58, frequency: 0.5, count: 18, speed: 1.0 },
};

export function makeLogoOptions() {
  return [{ id: "variation", label: "Variatie" }, ...LOGOS];
}
