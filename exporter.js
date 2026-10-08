function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export async function exportPng(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG kon niet worden gemaakt.")), "image/png"));
  downloadBlob(blob, `noordzuid-${timestamp()}.png`);
}

export function supportedMp4Type() {
  if (!window.MediaRecorder) return null;
  return ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=h264", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || null;
}

export async function exportMp4(canvas, durationSeconds, onProgress) {
  const mimeType = supportedMp4Type();
  if (!mimeType || !canvas.captureStream) throw new Error("MP4-export wordt niet ondersteund door deze browser. Open de tool in Safari of een recente Chromium-browser.");

  const stream = canvas.captureStream(60);
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 24_000_000 });
  const stopped = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(recorder.error || new Error("Opname mislukt."));
    recorder.onstop = resolve;
  });

  const startedAt = performance.now();
  recorder.start(250);
  const timer = window.setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    onProgress(Math.min(elapsed / durationSeconds, 0.99));
  }, 100);

  await new Promise((resolve) => window.setTimeout(resolve, durationSeconds * 1000));
  recorder.stop();
  await stopped;
  window.clearInterval(timer);
  stream.getTracks().forEach((track) => track.stop());
  onProgress(1);
  const blob = new Blob(chunks, { type: mimeType });
  downloadBlob(blob, `noordzuid-${timestamp()}.mp4`);
}
