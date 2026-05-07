/**
 * Probe a media file's duration on the main thread via the browser's
 * native HTMLMediaElement metadata loader. Returns in tens of milliseconds
 * for typical inputs — much faster than waiting for ffmpeg WASM to load,
 * which lets TrimScrubber position handles immediately.
 *
 * Both `modality: "audio"` and `modality: "video"` use the same lifecycle;
 * only the element tag differs. <audio> and <video> both extend
 * HTMLMediaElement, so `.duration`, `.preload`, `.src`, and the
 * loadedmetadata/error events are identical.
 */
export async function readMediaDurationSec(
  file: File,
  modality: "audio" | "video",
): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const el = document.createElement(modality) as HTMLMediaElement;
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
      const onError = () => settle(() => reject(new Error(`failed to load ${modality} metadata`)));
      el.addEventListener("loadedmetadata", onLoaded, { once: true });
      el.addEventListener("error", onError, { once: true });
      el.preload = "metadata";
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
