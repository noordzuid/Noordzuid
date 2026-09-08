'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, ImagePlus, Plus, Ratio, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { BoxContent } from './box-content';
import { createMp4 } from './export-mp4';
import {
  createBox, firstAvailable, formatNumber, gcd, gridMetrics, initialBox, initialProject, isRectValid,
  MAX_ZOOM, MIN_ZOOM, sketchParameters, GRID_ROWS, boxStyle,
  type BentoBox, type ContentType, type FitMode, type GridRect, type Interaction, type MediaElement, type Preview, type Project,
} from './model';

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
        execute: (input: unknown) => unknown;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

function NumberField({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (value: number) => void; min?: number }) {
  return <label className="field-label compact">{label}<Input aria-label={label} type="number" min={min} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function ControlSlider({ label, value, min, max, step = 1, suffix = '', onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void;
}) {
  return <div className="slider-control"><div className="range-row"><span>{label}</span><strong>{formatNumber(value)}{suffix}</strong></div><Slider aria-label={label} min={min} max={max} step={step} value={[value]} onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)} /></div>;
}

export function BentoStudio() {
  const [project, setProject] = useState<Project>(initialProject);
  const [boxes, setBoxes] = useState<BentoBox[]>([initialBox]);
  const [selectedId, setSelectedId] = useState<string | null>(initialBox.id);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [viewScale, setViewScale] = useState(0.35);
  const [message, setMessage] = useState('Klaar');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const boxesRef = useRef(boxes);
  const projectRef = useRef(project);
  const mediaRefs = useRef(new Map<string, MediaElement>());
  const { unit, margin, columns } = useMemo(() => gridMetrics(project), [project]);
  const selected = boxes.find((box) => box.id === selectedId) ?? null;

  useEffect(() => { boxesRef.current = boxes; }, [boxes]);
  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const fit = () => {
      const horizontalPadding = viewport.clientWidth < 700 ? 36 : 72;
      setViewScale(Math.max(0.05, Math.min((viewport.clientWidth - horizontalPadding) / project.width, (viewport.clientHeight - 64) / project.height)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [project.width, project.height]);

  const mediaRef = useCallback((id: string, element: MediaElement | null) => {
    if (element) mediaRefs.current.set(id, element);
    else mediaRefs.current.delete(id);
  }, []);

  const announce = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((current) => current === text ? 'Klaar' : current), 2600);
  }, []);

  const addBox = useCallback((contentType: ContentType = 'sketch') => {
    const current = boxesRef.current;
    const rect = firstAvailable(current, gridMetrics(projectRef.current).columns);
    if (!rect) { announce('Geen vrije rasterruimte meer'); return null; }
    const next = createBox(rect, contentType);
    setBoxes([...current, next]);
    setSelectedId(next.id);
    announce('Bento-box toegevoegd');
    return next;
  }, [announce]);

  const removeBox = useCallback((id: string) => {
    const target = boxesRef.current.find((box) => box.id === id);
    if (target?.objectUrl) URL.revokeObjectURL(target.objectUrl);
    const remaining = boxesRef.current.filter((box) => box.id !== id);
    setBoxes(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    announce('Bento-box verwijderd');
  }, [announce]);

  const duplicateBox = useCallback((box: BentoBox) => {
    const rect = firstAvailable(boxesRef.current, gridMetrics(projectRef.current).columns, box.w, box.h);
    if (!rect) { announce('Geen ruimte voor een duplicaat'); return; }
    const duplicate = { ...box, ...rect, id: crypto.randomUUID(), sketchParameters: { ...box.sketchParameters } };
    setBoxes((current) => [...current, duplicate]);
    setSelectedId(duplicate.id);
    announce('Bento-box gedupliceerd');
  }, [announce]);

  const patchBox = useCallback((id: string, patch: Partial<BentoBox>, validateGrid = false) => {
    const current = boxesRef.current;
    const target = current.find((box) => box.id === id);
    if (!target) return false;
    const next = { ...target, ...patch };
    if (validateGrid && !isRectValid(next, current, gridMetrics(projectRef.current).columns, id)) {
      announce('Positie of formaat past niet in het raster');
      return false;
    }
    setBoxes(current.map((box) => box.id === id ? next : box));
    return true;
  }, [announce]);

  const patchGridValue = (key: keyof GridRect, value: number) => {
    if (selected && Number.isFinite(value)) patchBox(selected.id, { [key]: Math.round(value) }, true);
  };

  const changeProjectDimension = (key: 'width' | 'height', value: number) => {
    if (!Number.isFinite(value) || value < 320 || value > 7680) return;
    const next = { ...project, [key]: Math.round(value) };
    const nextColumns = gridMetrics(next).columns;
    if (!boxes.every((box) => isRectValid(box, boxes, nextColumns, box.id))) {
      announce('Projectformaat is te klein voor de huidige indeling');
      return;
    }
    setProject(next);
  };

  const pointerDown = (event: React.PointerEvent, box: BentoBox, handle?: Interaction['handle']) => {
    if (exporting) return;
    event.stopPropagation();
    event.preventDefault();
    setSelectedId(box.id);
    const rect = { x: box.x, y: box.y, w: box.w, h: box.h };
    interactionRef.current = { id: box.id, mode: handle ? 'resize' : 'drag', handle, startX: event.clientX, startY: event.clientY, startBox: rect, lastValid: rect };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const dx = Math.round((event.clientX - interaction.startX) / (unit * viewScale));
    const dy = Math.round((event.clientY - interaction.startY) / (unit * viewScale));
    const start = interaction.startBox;
    let candidate: GridRect = { ...start };
    if (interaction.mode === 'drag') candidate = { ...start, x: start.x + dx, y: start.y + dy };
    else if (interaction.handle === 'se') candidate = { ...start, w: start.w + dx, h: start.h + dy };
    else if (interaction.handle === 'sw') candidate = { x: start.x + dx, y: start.y, w: start.w - dx, h: start.h + dy };
    else if (interaction.handle === 'ne') candidate = { x: start.x, y: start.y + dy, w: start.w + dx, h: start.h - dy };
    else if (interaction.handle === 'nw') candidate = { x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy };
    const valid = isRectValid(candidate, boxesRef.current, columns, interaction.id);
    setPreview({ ...candidate, valid, id: interaction.id });
    if (valid) {
      interaction.lastValid = candidate;
      setBoxes((current) => current.map((box) => box.id === interaction.id ? { ...box, ...candidate } : box));
    }
  };

  const pointerUp = () => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const wasValid = preview?.valid ?? true;
    setBoxes((current) => current.map((box) => box.id === interaction.id ? { ...box, ...interaction.lastValid } : box));
    interactionRef.current = null;
    setPreview(null);
    if (!wasValid) announce('Ongeldige plaatsing geweigerd');
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !target.isContentEditable) {
        event.preventDefault(); removeBox(selectedId);
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [removeBox, selectedId]);

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!selected) return;
    const file = event.target.files?.[0];
    if (!file) return;
    if (selected.objectUrl) URL.revokeObjectURL(selected.objectUrl);
    patchBox(selected.id, { fileName: file.name, objectUrl: URL.createObjectURL(file) });
    announce(`${selected.contentType === 'image' ? 'Afbeelding' : 'Video'} geladen`);
  };

  const changeContentType = (box: BentoBox, contentType: ContentType) => {
    if (box.objectUrl) URL.revokeObjectURL(box.objectUrl);
    patchBox(box.id, { contentType, fileName: undefined, objectUrl: undefined });
  };

  const exportMp4 = async () => {
    if (exporting) return;
    setExporting(true); setExportProgress(0); setMessage('Export voorbereiden');
    try {
      const snapshot = projectRef.current;
      const blob = await createMp4(snapshot, boxesRef.current, mediaRefs.current, setExportProgress);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${snapshot.name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'bento-composition'}.mp4`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage('MP4 gedownload');
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'Export mislukt');
    } finally { setExporting(false); }
  };

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name: 'add_bento_box', title: 'Bento-box toevoegen',
        description: 'Voeg een nieuw vrij geplaatst Bento-vak toe aan de zichtbare compositie.',
        inputSchema: { type: 'object', properties: { contentType: { type: 'string', enum: ['sketch', 'image', 'video'] } }, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          const value = input as { contentType?: string };
          const type = value?.contentType ?? 'sketch';
          if (!['sketch', 'image', 'video'].includes(type)) throw new Error('Ongeldig inhoudstype');
          const box = addBox(type as ContentType);
          if (!box) throw new Error('Geen vrije rasterruimte');
          return { id: box.id, contentType: box.contentType, position: { x: box.x, y: box.y }, size: { width: box.w, height: box.h } };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* Optional in browsers without WebMCP support. */ }
    return () => lifecycle.abort();
  }, [addBox]);

  const aspectDivisor = gcd(project.width, project.height);
  const aspect = `${project.width / aspectDivisor}:${project.height / aspectDivisor}`;

  return (
    <main className="studio-shell" onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <aside className="inspector" onPointerDown={(event) => event.stopPropagation()}>
        <div className="brand-row"><span className="brand-mark"><Sparkles size={15} strokeWidth={2.4} /></span><div><strong>Noordzuid</strong><span>Bento Studio</span></div></div>
        <div className="panel-scroll">
          <section className="control-section">
            <div className="section-heading"><span>01</span><h2>Project</h2></div>
            <label className="field-label" htmlFor="project-name">Projectnaam<Input id="project-name" value={project.name} onChange={(event) => setProject({ ...project, name: event.target.value })} /></label>
            <div className="field-grid"><NumberField label="Breedte" value={project.width} min={320} onChange={(value) => changeProjectDimension('width', value)} /><NumberField label="Hoogte" value={project.height} min={320} onChange={(value) => changeProjectDimension('height', value)} /></div>
            <label className="field-label color-field">Canvasachtergrond<input type="color" value={project.background} onChange={(event) => setProject({ ...project, background: event.target.value })} /></label>
            <div className="field-grid"><NumberField label="Framerate" value={project.fps} min={1} onChange={(value) => setProject({ ...project, fps: Math.min(60, Math.max(1, Math.round(value))) })} /><NumberField label="Duur (sec)" value={project.duration} min={1} onChange={(value) => setProject({ ...project, duration: Math.min(60, Math.max(1, value)) })} /></div>
            <div className="summary-row"><Ratio size={14} /><span>{aspect}</span><span>{columns} × {GRID_ROWS} raster</span></div>
            <Button className="add-button" variant="outline" onClick={() => addBox()}><Plus size={15} /> Bento-box toevoegen</Button>
          </section>

          <section className={`control-section ${!selected ? 'disabled-section' : ''}`}>
            <div className="section-heading"><span>02</span><h2>Bento</h2>{selected && <em>{selected.contentType}</em>}</div>
            {selected ? <>
              <div className="field-label"><span>Inhoudstype</span><Select value={selected.contentType} onValueChange={(value) => changeContentType(selected, value as ContentType)}><SelectTrigger className="panel-select" aria-label="Inhoudstype"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sketch">p5.js Sketch</SelectItem><SelectItem value="image">Afbeelding</SelectItem><SelectItem value="video">Video</SelectItem></SelectContent></Select></div>
              <div className="field-grid four"><NumberField label="X" value={selected.x} onChange={(value) => patchGridValue('x', value)} /><NumberField label="Y" value={selected.y} onChange={(value) => patchGridValue('y', value)} /><NumberField label="B" value={selected.w} min={1} onChange={(value) => patchGridValue('w', value)} /><NumberField label="H" value={selected.h} min={1} onChange={(value) => patchGridValue('h', value)} /></div>
              <ControlSlider label="Hoekafronding" value={selected.radius} min={0} max={160} suffix="px" onChange={(value) => patchBox(selected.id, { radius: value })} />
              <ControlSlider label="Inhoudszoom" value={selected.zoom} min={MIN_ZOOM} max={MAX_ZOOM} step={0.05} suffix="×" onChange={(value) => patchBox(selected.id, { zoom: value })} />
              <ControlSlider label="Horizontaal" value={selected.positionX} min={-100} max={100} suffix="%" onChange={(value) => patchBox(selected.id, { positionX: value })} />
              <ControlSlider label="Verticaal" value={selected.positionY} min={-100} max={100} suffix="%" onChange={(value) => patchBox(selected.id, { positionY: value })} />
              {selected.contentType !== 'sketch' && <><div className="field-label"><span>Weergave</span><Select value={selected.fit} onValueChange={(value) => patchBox(selected.id, { fit: value as FitMode })}><SelectTrigger className="panel-select" aria-label="Weergave"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cover">Cover</SelectItem><SelectItem value="contain">Contain</SelectItem></SelectContent></Select></div><label className="file-picker" htmlFor={`media-${selected.id}`}><ImagePlus size={15} /><span>{selected.fileName ?? 'Kies lokaal bestand'}</span><input id={`media-${selected.id}`} type="file" accept={selected.contentType === 'image' ? 'image/*' : 'video/*'} onChange={selectFile} /></label></>}
              <div className="button-pair"><Button variant="outline" onClick={() => duplicateBox(selected)}><Copy size={14} /> Dupliceren</Button><Button variant="outline" className="delete-button" onClick={() => removeBox(selected.id)}><Trash2 size={14} /> Verwijderen</Button></div>
            </> : <p className="empty-note">Selecteer een box op het canvas.</p>}
          </section>

          <section className={`control-section ${!selected || selected.contentType !== 'sketch' ? 'disabled-section' : ''}`}>
            <div className="section-heading"><span>03</span><h2>Sketch</h2></div>
            {selected?.contentType === 'sketch' ? <>
              {/* Connect future p5 sketch parameters to Sketch Settings through sketchParameters. */}
              <label className="field-label color-field">{sketchParameters.backgroundColor.label}<input type="color" value={selected.sketchParameters.backgroundColor} onChange={(event) => patchBox(selected.id, { sketchParameters: { ...selected.sketchParameters, backgroundColor: event.target.value } })} /></label>
              <ControlSlider label={sketchParameters.speed.label} value={selected.sketchParameters.speed} min={sketchParameters.speed.min} max={sketchParameters.speed.max} step={sketchParameters.speed.step} onChange={(value) => patchBox(selected.id, { sketchParameters: { ...selected.sketchParameters, speed: value } })} />
            </> : <p className="empty-note">Alleen beschikbaar voor p5.js-sketches.</p>}
          </section>
        </div>
        <div className="export-wrap">{exporting && <div className="export-progress"><span>Exporteren</span><b>{exportProgress}%</b><Progress value={exportProgress} /></div>}<Button className="export-button" disabled={exporting} onClick={exportMp4}><Download size={17} /> {exporting ? 'MP4 wordt gemaakt…' : 'Export MP4'} <span>{project.duration} sec</span></Button></div>
      </aside>

      <section className="workspace">
        <header className="workspace-bar"><span>{project.name || 'Zonder titel'}</span><span className="saved-dot" /><small aria-live="polite">{message}</small><div className="workspace-meta">{project.width} × {project.height}<b>{Math.round(viewScale * 100)}%</b></div></header>
        <div className="stage-wrap" ref={viewportRef} onPointerDown={() => setSelectedId(null)}>
          <div className="project-stage" aria-label="Projectcanvas" style={{ width: project.width * viewScale, height: project.height * viewScale, background: project.background }} onPointerDown={(event) => { event.stopPropagation(); setSelectedId(null); }}>
            {preview && <div className={`position-preview ${preview.valid ? 'valid' : 'invalid'}`} style={boxStyle(preview, unit, margin, viewScale)} />}
            {boxes.map((box, index) => <div key={box.id} className={`bento-box ${selectedId === box.id ? 'selected' : ''}`} data-type={box.contentType} style={{ ...boxStyle(box, unit, margin, viewScale), borderRadius: box.radius * viewScale }} onPointerDown={(event) => pointerDown(event, box)} onWheel={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedId(box.id); patchBox(box.id, { zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, box.zoom + (event.deltaY < 0 ? 0.1 : -0.1))) }); }}>
              <div className="content-clip" style={{ borderRadius: box.radius * viewScale }}><BoxContent box={box} mediaRef={mediaRef} /></div>
              {selectedId === box.id && <><span className="box-label">{box.contentType.toUpperCase()} {String(index + 1).padStart(2, '0')}</span>{(['nw', 'ne', 'sw', 'se'] as const).map((handle) => <button type="button" aria-label={`Formaat wijzigen ${handle}`} key={handle} className={`handle ${handle}`} onPointerDown={(event) => pointerDown(event, box, handle)} />)}</>}
            </div>)}
          </div>
        </div>
        <footer className="status-bar"><span>Raster {formatNumber(unit)} px</span><span>Marge {formatNumber(margin)} px</span><span>{boxes.length} {boxes.length === 1 ? 'box' : 'boxes'}</span><span className="status-tip">Scroll boven een box om alleen de inhoud te zoomen</span></footer>
      </section>
    </main>
  );
}
