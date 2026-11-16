export interface CapturedImage {
  base64: string;
  mimeType: "image/jpeg";
  dataUrl: string;
}

/** Downscale to keep the on-device prompt small (Nano's context is limited) while keeping digits legible. */
const MAX_SIDE = 768;

export function captureFrom(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): CapturedImage {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!w || !h) throw new Error("Camera isn't ready yet.");
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { base64: dataUrl.split(",")[1], mimeType: "image/jpeg", dataUrl };
}

export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't open that image."));
    img.src = URL.createObjectURL(file);
  });
}
