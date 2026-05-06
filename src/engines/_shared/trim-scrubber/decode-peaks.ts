import type { FFmpeg as FFmpegType } from "@ffmpeg/ffmpeg";

export type Peaks = {
  min: Float32Array; // length === bucketCount, range [-1, 0]
  max: Float32Array; // length === bucketCount, range [0, 1]
};

/** Bucket a PCM stream into per-bucket (min, max) pairs. Pure function. */
export function peaksFromPCM(pcm: Float32Array, bucketCount: number): Peaks {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
    throw new Error(`peaksFromPCM: bucketCount must be a positive integer, got ${bucketCount}`);
  }
  const min = new Float32Array(bucketCount);
  const max = new Float32Array(bucketCount);
  if (pcm.length === 0) {
    return { min, max };
  }
  const samplesPerBucket = pcm.length / bucketCount;
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = b === bucketCount - 1 ? pcm.length : Math.floor((b + 1) * samplesPerBucket);
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = pcm[i] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/**
 * Worker-only helper: feed `bytes` into ffmpeg, decode to mono f32le PCM at a
 * decimated sample rate, and bucket into `bucketCount` peaks. Must run inside
 * an engine worker that already holds an FFmpeg instance (do NOT call
 * loadFfmpeg() from main thread for peak decoding — see phase 20 spec §2.5b).
 */
export async function decodePeaksInWorker(
  ff: FFmpegType,
  bytes: ArrayBuffer,
  fileExtension: string,
  bucketCount: number,
): Promise<Peaks> {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
    throw new Error(
      `decodePeaksInWorker: bucketCount must be a positive integer, got ${bucketCount}`,
    );
  }
  const ext = fileExtension.toLowerCase().replace(/^\./, "");
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inName = `peaks-in-${id}.${ext || "bin"}`;
  const outName = `peaks-out-${id}.pcm`;

  // Target ~bucketCount * 256 samples in the decoded stream so each bucket has
  // enough material to compute meaningful min/max without fetching the entire
  // PCM. -ar 8000 + -ac 1 gives mono 8 kHz f32le — for a 60 s file that's
  // ~480k samples; bucketing to 512 gives ~937 samples per bucket.
  const args = [
    "-i",
    inName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "-c:a",
    "pcm_f32le",
    outName,
  ];

  try {
    await ff.writeFile(inName, new Uint8Array(bytes));
    const exitCode = await ff.exec(args);
    if (exitCode !== 0) {
      throw new Error(`decodePeaksInWorker: ffmpeg exited with code ${exitCode}`);
    }
    const out = await ff.readFile(outName);
    if (typeof out === "string") {
      throw new Error("decodePeaksInWorker: ffmpeg returned text output unexpectedly");
    }
    const u8 = out as Uint8Array;
    // Float32Array view requires a 4-byte aligned ArrayBuffer slice; copy to a
    // fresh buffer to avoid alignment surprises across runtimes.
    const aligned = new ArrayBuffer(u8.byteLength);
    new Uint8Array(aligned).set(u8);
    const pcm = new Float32Array(aligned);
    return peaksFromPCM(pcm, bucketCount);
  } finally {
    try {
      await ff.deleteFile(inName);
    } catch {
      /* best-effort */
    }
    try {
      await ff.deleteFile(outName);
    } catch {
      /* best-effort */
    }
  }
}
