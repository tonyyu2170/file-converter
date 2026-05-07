//
// Container/codec compatibility for the video-trim engine's container
// dropdown. Used to disable container choices that the source's codecs
// don't fit, before the user clicks Convert.
//
// "same" is always allowed (the engine will preserve the source container).
// "mkv" is always allowed (Matroska is a permissive catch-all).
// "mp4" and "webm" enforce the container's codec compatibility.

export type Container = "mp4" | "webm" | "mkv";
export type ContainerOrSame = Container | "same";

export const CONTAINER_CODECS: Record<Container, { video: string[]; audio: string[] } | null> = {
  mp4: { video: ["h264", "hevc", "av1"], audio: ["aac", "mp3"] },
  webm: { video: ["vp8", "vp9", "av1"], audio: ["opus", "vorbis"] },
  mkv: null, // accepts anything
};

export function containerSupportsCodecs(
  container: ContainerOrSame,
  videoCodec: string | null,
  audioCodec: string | null,
): boolean {
  if (container === "same") return true;
  const allowed = CONTAINER_CODECS[container];
  if (allowed === null) return true; // mkv
  if (videoCodec !== null && !allowed.video.includes(videoCodec)) return false;
  if (audioCodec !== null && !allowed.audio.includes(audioCodec)) return false;
  return true;
}
