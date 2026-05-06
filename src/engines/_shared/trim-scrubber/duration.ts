/**
 * Probe a media file's duration on the main thread via the browser's
 * native HTMLMediaElement metadata loader. Returns in tens of milliseconds
 * for typical audio inputs — much faster than waiting for ffmpeg WASM to
 * load, which lets TrimScrubber position handles immediately.
 *
 * Phase 20 implements `modality: "audio"` only. The `"video"` branch is
 * a typed stub that throws so Phase 22 can extend additively (no API churn).
 */
export async function readMediaDurationSec(
  file: File,
  modality: "audio" | "video",
): Promise<number> {
  if (modality === "video") {
    throw new Error("video modality not implemented in phase 20 — deferred to phase 22");
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const el = document.createElement("audio");
      const watchdog = setTimeout(() => {
        reject(new Error("media metadata timeout (10s)"));
      }, 10_000);
      const settle = (fn: () => void) => {
        clearTimeout(watchdog);
        fn();
      };
      const onLoaded = () =>
        settle(() => {
          if (Number.isFinite(el.duration) && el.duration > 0) {
            resolve(el.duration);
          } else {
            reject(new Error("media duration is not finite"));
          }
        });
      const onError = () => settle(() => reject(new Error("failed to load audio metadata")));
      el.addEventListener("loadedmetadata", onLoaded, { once: true });
      el.addEventListener("error", onError, { once: true });
      el.preload = "metadata";
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
