/**
 * Pure helpers for client-side logo crop + compression.
 * No browser-specific globals used directly so unit tests can import freely.
 */

export type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Given the pixel crop rectangle produced by react-easy-crop's onCropComplete,
 * draw the cropped region of `imageSrc` onto a canvas and return a Blob.
 *
 * This function is browser-only (uses HTMLCanvasElement + Image). Guard any
 * call site with a check that it's running in a browser context.
 */
export async function cropImageToBlob(
  imageSrc: string,
  pixelCrop: CropArea,
  outputType: "image/webp" | "image/jpeg" | "image/png" = "image/webp",
  quality = 0.92,
): Promise<Blob> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  ctx.drawImage(
    img,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas.toBlob returned null"));
      },
      outputType,
      quality,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Determine the best output mime type for the processed logo file.
 * Prefer the original type if it's one of the allowed types; otherwise webp.
 */
export function resolveOutputType(
  originalType: string,
): "image/webp" | "image/jpeg" | "image/png" {
  if (
    originalType === "image/png" ||
    originalType === "image/jpeg" ||
    originalType === "image/webp"
  ) {
    return originalType as "image/webp" | "image/jpeg" | "image/png";
  }
  return "image/webp";
}

/**
 * Extension string matching the given mime type, used for the File constructor.
 */
export function mimeToExt(
  type: "image/webp" | "image/jpeg" | "image/png",
): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}
