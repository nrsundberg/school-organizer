/**
 * LogoCropModal — browser-only crop + compress dialog for logo upload.
 *
 * Lazily imported from branding.tsx to keep these browser-only libs out of
 * the SSR bundle.
 */
import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import type { Area } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import imageCompression from "browser-image-compression";
import { cropImageToBlob, resolveOutputType, mimeToExt } from "~/lib/image-crop";

type Props = {
  /** Object URL of the raw file the user selected. */
  imageSrc: string;
  /** Original file (used for mime type). */
  originalFile: File;
  onConfirm: (processedFile: File) => void;
  onCancel: () => void;
};

export default function LogoCropModal({
  imageSrc,
  originalFile,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation("admin");

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  const onCropComplete = useCallback((_: Area, pixelArea: Area) => {
    setCroppedAreaPixels(pixelArea);
  }, []);

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setProcessing(true);
    try {
      const outputType = resolveOutputType(originalFile.type);
      const croppedBlob = await cropImageToBlob(imageSrc, croppedAreaPixels, outputType);

      // Compress: target ≤ 300 KB, max 512 px on longest side.
      const ext = mimeToExt(outputType);
      const croppedFile = new File(
        [croppedBlob],
        `logo-crop.${ext}`,
        { type: outputType },
      );
      const compressed = await imageCompression(croppedFile, {
        maxSizeMB: 0.3,
        maxWidthOrHeight: 512,
        useWebWorker: true,
        fileType: outputType,
        initialQuality: 0.85,
      });

      // Make sure the final File has the right name + type.
      const finalFile = new File(
        [compressed],
        `logo.${ext}`,
        { type: outputType },
      );
      onConfirm(finalFile);
    } finally {
      setProcessing(false);
    }
  }

  return (
    /* Full-screen modal overlay */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label={t("branding.cropModal.title")}
    >
      <div className="flex flex-col gap-4 rounded-xl bg-[#1a1f1f] border border-white/10 p-5 w-full max-w-sm mx-4">
        <h2 className="text-base font-semibold text-white">
          {t("branding.cropModal.title")}
        </h2>

        {/* Crop area — react-easy-crop needs a positioned container with explicit size */}
        <div className="relative w-full" style={{ paddingBottom: "100%" }}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="rect"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            style={{
              containerStyle: {
                position: "absolute",
                inset: 0,
                borderRadius: "0.5rem",
                overflow: "hidden",
              },
            }}
            classes={{}}
          />
        </div>

        {/* Zoom slider */}
        <label className="flex flex-col gap-1 text-xs text-white/60">
          {t("branding.cropModal.zoomLabel")}
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-blue-400"
          />
        </label>

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-white/20 px-3 py-1.5 text-sm text-white/70 hover:text-white hover:border-white/40"
          >
            {t("branding.cropModal.cancel")}
          </button>
          <Button
            type="button"
            variant="primary"
            isPending={processing}
            onPress={handleConfirm}
          >
            {t("branding.cropModal.apply")}
          </Button>
        </div>
      </div>
    </div>
  );
}
