export type ParsedVideo =
  | { kind: "youtube"; embed: string }
  | { kind: "vimeo"; embed: string }
  | { kind: "file"; src: string }
  | null;

/** Turns a YouTube / Vimeo / .mp4 URL into something the modal can play. */
export function parseVideoUrl(url?: string): ParsedVideo {
  if (!url || !url.trim()) return null;
  const u = url.trim();

  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) {
    return {
      kind: "youtube",
      embed: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0&modestbranding=1`,
    };
  }

  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: "vimeo", embed: `https://player.vimeo.com/video/${vm[1]}?autoplay=1&dnt=1` };

  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(u)) return { kind: "file", src: u };

  return null;
}
