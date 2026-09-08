import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { BentoBox, MediaElement, Project } from './model';
import { gridMetrics, gridRectToProject } from './model';

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function sourceSize(element: MediaElement) {
  if (element instanceof HTMLVideoElement) return { width: element.videoWidth, height: element.videoHeight };
  if (element instanceof HTMLImageElement) return { width: element.naturalWidth, height: element.naturalHeight };
  return { width: element.width, height: element.height };
}

function drawComposition(ctx: CanvasRenderingContext2D, project: Project, boxes: BentoBox[], media: Map<string, MediaElement>) {
  const metrics = gridMetrics(project);
  ctx.fillStyle = project.background;
  ctx.fillRect(0, 0, project.width, project.height);
  for (const box of boxes) {
    const rect = gridRectToProject(box, metrics);
    ctx.save();
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, box.radius);
    ctx.clip();
    ctx.fillStyle = box.contentType === 'sketch' ? box.sketchParameters.backgroundColor : box.background;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    const element = media.get(box.id);
    if (element) {
      const { width: sourceW, height: sourceH } = sourceSize(element);
      if (sourceW && sourceH) {
        const base = box.fit === 'cover' ? Math.max(rect.width / sourceW, rect.height / sourceH) : Math.min(rect.width / sourceW, rect.height / sourceH);
        const width = sourceW * base * box.zoom;
        const height = sourceH * base * box.zoom;
        const x = rect.x + (rect.width - width) / 2 + (box.positionX / 100) * rect.width / 2;
        const y = rect.y + (rect.height - height) / 2 + (box.positionY / 100) * rect.height / 2;
        ctx.drawImage(element, x, y, width, height);
      }
    }
    ctx.restore();
  }
}

export async function createMp4(project: Project, boxes: BentoBox[], media: Map<string, MediaElement>, onProgress: (value: number) => void) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) throw new Error('Deze browser ondersteunt geen MP4-export via WebCodecs');
  if (project.width % 2 !== 0 || project.height % 2 !== 0) throw new Error('MP4-export vereist een even breedte en hoogte');
  const videos = [...media.values()].filter((element): element is HTMLVideoElement => element instanceof HTMLVideoElement);
  await Promise.all(videos.map(async (video) => {
    video.pause();
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) resolve();
      else video.addEventListener('loadeddata', () => resolve(), { once: true });
    });
    await video.play().catch(() => undefined);
  }));

  const canvas = document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas niet beschikbaar');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: project.width, height: project.height, frameRate: project.fps }, fastStart: 'in-memory' });
  const baseConfig = {
    width: project.width, height: project.height,
    bitrate: Math.max(2_000_000, Math.min(16_000_000, project.width * project.height * 4)), framerate: project.fps,
  };
  const codecs = ['avc1.42002A', 'avc1.4D002A', 'avc1.64002A', 'avc1.420033', 'avc1.4D0033', 'avc1.640033'];
  let supportedConfig: VideoEncoderConfig | null = null;
  for (const codec of codecs) {
    try {
      const config: VideoEncoderConfig = { ...baseConfig, codec };
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        supportedConfig = support.config ?? config;
        break;
      }
    } catch {
      // Try the next broadly supported H.264 profile and level.
    }
  }
  if (!supportedConfig) throw new Error('Deze browser ondersteunt geen geschikte H.264-configuratie voor MP4-export');
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (error) => { encoderError = error; } });
  encoder.configure(supportedConfig);
  const totalFrames = Math.round(project.duration * project.fps);
  const frameDuration = 1_000_000 / project.fps;
  const startedAt = performance.now();
  for (let index = 0; index < totalFrames; index += 1) {
    const wait = startedAt + (index * 1000) / project.fps - performance.now();
    if (wait > 1) await new Promise((resolve) => window.setTimeout(resolve, wait));
    drawComposition(ctx, project, boxes, media);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(index * frameDuration), duration: Math.round(frameDuration) });
    encoder.encode(frame, { keyFrame: index % project.fps === 0 });
    frame.close();
    if (index % Math.max(1, Math.floor(project.fps / 3)) === 0) onProgress(Math.round(((index + 1) / totalFrames) * 100));
    if (encoderError) throw encoderError;
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  videos.forEach((video) => video.pause());
  onProgress(100);
  return new Blob([target.buffer], { type: 'video/mp4' });
}
