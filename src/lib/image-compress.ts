/**
 * Client-side image compression for uploads (payment proofs, GST docs, etc.).
 *
 * Phone cameras produce 4–12 MB JPEGs; uploading those over a 3G connection is
 * the single slowest action in the app. We downscale to a sane max edge and
 * re-encode before upload, and additionally produce a small thumbnail that the
 * UI can show inline without ever fetching the full-resolution file.
 *
 * Non-images (PDFs) pass through untouched.
 */

export const FULL_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 400;

export type PreparedUpload = {
  /** Compressed (or original, for non-images) file to upload. */
  file: File;
  /** Small preview derived from the same image, or null for non-images. */
  thumb: File | null;
};

function isCompressibleImage(file: File) {
  return /^image\/(jpeg|jpg|png|webp)$/i.test(file.type);
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function drawToBlob(
  source: ImageBitmap | HTMLImageElement,
  maxEdge: number,
  quality: number,
): Promise<Blob | null> {
  const w = "width" in source ? source.width : 0;
  const h = "height" in source ? source.height : 0;
  const scale = Math.min(1, maxEdge / Math.max(w, h) || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Downscale + compress an upload and build its thumbnail. Never throws. */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  if (!isCompressibleImage(file) || typeof document === "undefined") {
    return { file, thumb: null };
  }
  try {
    const source = await decode(file);
    const [fullBlob, thumbBlob] = await Promise.all([
      drawToBlob(source, FULL_MAX_EDGE, 0.78),
      drawToBlob(source, THUMB_MAX_EDGE, 0.6),
    ]);
    if ("close" in source && typeof source.close === "function") source.close();

    const base = file.name.replace(/\.[^.]+$/, "");
    // Only keep the re-encode when it actually saves bytes.
    const useFull = fullBlob && fullBlob.size < file.size;
    return {
      file: useFull
        ? new File([fullBlob], `${base}.jpg`, { type: "image/jpeg" })
        : file,
      thumb: thumbBlob ? new File([thumbBlob], `${base}-thumb.jpg`, { type: "image/jpeg" }) : null,
    };
  } catch {
    return { file, thumb: null };
  }
}

/** Storage path convention for a proof's thumbnail. */
export function thumbPathFor(path: string) {
  return `${path}.thumb.jpg`;
}
