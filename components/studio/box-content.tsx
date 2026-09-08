'use client';

import { useEffect, useRef } from 'react';
import type p5 from 'p5';
import { FileImage, Film } from 'lucide-react';
import type { BentoBox, MediaElement, SketchValues } from './model';

function P5Sketch({ values }: { values: SketchValues }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<p5 | null>(null);
  const valuesRef = useRef(values);

  useEffect(() => {
    valuesRef.current = values;
    instanceRef.current?.background(values.backgroundColor);
  }, [values]);

  useEffect(() => {
    let mounted = true;
    let resizeObserver: ResizeObserver | undefined;
    void import('p5').then(({ default: P5 }) => {
      if (!mounted || !hostRef.current) return;
      const sketch = (p: p5) => {
        p.setup = () => {
          const host = hostRef.current!;
          const canvas = p.createCanvas(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
          canvas.attribute('aria-hidden', 'true');
          p.pixelDensity(1);
          p.noLoop();
          p.background(valuesRef.current.backgroundColor);
          resizeObserver = new ResizeObserver(() => {
            if (!hostRef.current) return;
            p.resizeCanvas(Math.max(1, hostRef.current.clientWidth), Math.max(1, hostRef.current.clientHeight));
            p.background(valuesRef.current.backgroundColor);
          });
          resizeObserver.observe(host);
        };
      };
      instanceRef.current = new P5(sketch, hostRef.current);
    });
    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      instanceRef.current?.remove();
      instanceRef.current = null;
    };
  }, []);

  return <div className="p5-host" ref={hostRef} />;
}

export function BoxContent({ box, mediaRef }: { box: BentoBox; mediaRef: (id: string, element: MediaElement | null) => void }) {
  const style = {
    transform: `translate(${box.positionX / 2}%, ${box.positionY / 2}%) scale(${box.zoom})`,
    objectFit: box.fit,
  } as const;
  if (box.contentType === 'image' && box.objectUrl) {
    // Local object URLs cannot be optimized by next/image.
    // oxlint-disable-next-line next/no-img-element
    return <img ref={(element) => mediaRef(box.id, element)} className="media-content" src={box.objectUrl} alt={box.fileName ?? 'Geüploade afbeelding'} style={style} />;
  }
  if (box.contentType === 'video' && box.objectUrl) {
    return <video ref={(element) => mediaRef(box.id, element)} className="media-content" src={box.objectUrl} style={style} autoPlay loop muted playsInline />;
  }
  if (box.contentType !== 'sketch') {
    return <div className="media-empty">{box.contentType === 'image' ? <FileImage /> : <Film />}<span>Kies een bestand</span></div>;
  }
  return <div className="sketch-content" style={{ transform: `translate(${box.positionX / 2}%, ${box.positionY / 2}%) scale(${box.zoom})` }}><P5Sketch values={box.sketchParameters} /></div>;
}
