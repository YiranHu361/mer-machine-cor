import type { DesignDraft, DraftInput } from "../../integrations/src/claude.ts";

/* Hand-drawn line art in the producer's SVG subset (200×200, black and white,
   no transforms). It stands in for Claude's drafts so a soak run costs nothing. */

const round = (n: number) => Math.round(n * 10) / 10;
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [round(cx + r * Math.cos(a)), round(cy + r * Math.sin(a))];
};
const star = () =>
  Array.from({ length: 10 }, (_, k) =>
    polar(100, 105, k % 2 ? 32 : 78, -90 + k * 36).join(","),
  ).join(" ");
const rays = (cx: number, cy: number, from: number, to: number, n: number) =>
  Array.from({ length: n }, (_, k) => {
    const [x1, y1] = polar(cx, cy, from, (360 / n) * k);
    const [x2, y2] = polar(cx, cy, to, (360 / n) * k);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }).join("");
const petals = () =>
  Array.from({ length: 6 }, (_, k) => {
    const [x, y] = polar(100, 80, 30, k * 60);
    return `<circle cx="${x}" cy="${y}" r="18"/>`;
  }).join("");
const dot = (x: number, y: number, r = 6) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="black" stroke="none"/>`;

/** Each subject's strokes; filled details use fill="black" explicitly. */
export const SUBJECTS: Record<string, string> = {
  cat: `<circle cx="100" cy="112" r="50"/><polygon points="62,80 70,35 96,64"/><polygon points="138,80 130,35 104,64"/>${dot(82, 106)}${dot(118, 106)}<polygon points="94,122 106,122 100,130" fill="black" stroke="none"/><line x1="40" y1="118" x2="78" y2="124"/><line x1="160" y1="118" x2="122" y2="124"/>`,
  dog: `<ellipse cx="100" cy="108" rx="46" ry="50"/><path d="M60 72 Q32 92 44 136"/><path d="M140 72 Q168 92 156 136"/>${dot(84, 100)}${dot(116, 100)}<ellipse cx="100" cy="124" rx="10" ry="7" fill="black" stroke="none"/><path d="M86 140 Q100 152 114 140"/>`,
  star: `<polygon points="${star()}"/>`,
  heart: `<path d="M100 165 C40 125 28 72 64 56 C86 47 100 62 100 76 C100 62 114 47 136 56 C172 72 160 125 100 165 Z"/>`,
  sun: `<circle cx="100" cy="100" r="32"/>${rays(100, 100, 46, 74, 10)}`,
  moon: `<path d="M118 32 A68 68 0 1 0 168 128 A52 52 0 1 1 118 32 Z"/>${dot(60, 52, 4)}${dot(48, 92, 3)}`,
  cloud: `<path d="M48 142 A26 26 0 0 1 58 94 A36 36 0 0 1 126 80 A30 30 0 0 1 162 116 A24 24 0 0 1 152 142 Z"/><line x1="70" y1="162" x2="62" y2="178"/><line x1="100" y1="162" x2="92" y2="178"/><line x1="130" y1="162" x2="122" y2="178"/>`,
  tree: `<circle cx="100" cy="82" r="48"/><rect x="90" y="128" width="20" height="44"/><line x1="40" y1="172" x2="160" y2="172"/>`,
  flower: `${petals()}<circle cx="100" cy="80" r="14" fill="black" stroke="none"/><line x1="100" y1="112" x2="100" y2="178"/><path d="M100 150 Q130 128 146 144 Q124 162 100 150 Z"/>`,
  house: `<polygon points="38,96 100,40 162,96"/><rect x="56" y="96" width="88" height="72"/><rect x="88" y="124" width="24" height="44"/><rect x="66" y="108" width="16" height="16"/><rect x="118" y="108" width="16" height="16"/>`,
  rocket: `<path d="M100 24 C132 56 130 114 120 142 L80 142 C70 114 68 56 100 24 Z"/><circle cx="100" cy="76" r="12"/><polygon points="80,116 58,152 82,142"/><polygon points="120,116 142,152 118,142"/><path d="M88 150 Q100 182 112 150"/>`,
  fish: `<ellipse cx="88" cy="100" rx="50" ry="30"/><polygon points="136,100 172,72 172,128"/>${dot(64, 94)}<path d="M96 76 Q104 100 96 124"/>`,
  bird: `<path d="M44 122 Q64 70 118 80 Q146 85 160 70 L150 96 Q140 132 94 136 Q62 136 44 122 Z"/><path d="M84 104 Q104 92 124 110"/>${dot(70, 98, 5)}<polygon points="44,116 26,122 44,128" fill="black" stroke="none"/>`,
  mountain: `<polygon points="20,164 80,60 118,122 144,88 182,164"/><polyline points="64,88 80,60 96,88 88,82 80,92 72,82 64,88"/><circle cx="150" cy="46" r="14"/>`,
  boat: `<path d="M38 122 L162 122 L140 152 L60 152 Z"/><line x1="100" y1="122" x2="100" y2="34"/><polygon points="104,40 104,112 152,112"/><path d="M24 172 Q44 162 64 172 Q84 182 104 172 Q124 162 144 172 Q164 182 180 172"/>`,
  umbrella: `<path d="M28 102 A72 72 0 0 1 172 102 Q154 90 136 102 Q118 90 100 102 Q82 90 64 102 Q46 90 28 102 Z"/><path d="M100 102 L100 162 A13 13 0 0 1 74 162"/>`,
  key: `<circle cx="60" cy="100" r="30"/><circle cx="60" cy="100" r="10"/><line x1="90" y1="100" x2="172" y2="100"/><line x1="150" y1="100" x2="150" y2="124"/><line x1="166" y1="100" x2="166" y2="118"/>`,
  cup: `<path d="M54 74 L64 160 L132 160 L142 74 Z"/><path d="M142 92 A20 20 0 0 1 138 136"/><path d="M80 58 Q72 44 80 30"/><path d="M100 58 Q92 44 100 30"/><path d="M120 58 Q112 44 120 30"/>`,
  music: `<ellipse cx="66" cy="148" rx="18" ry="13" fill="black" stroke="none"/><ellipse cx="140" cy="132" rx="18" ry="13" fill="black" stroke="none"/><line x1="82" y1="148" x2="82" y2="54"/><line x1="156" y1="132" x2="156" y2="38"/><polygon points="82,54 156,38 156,60 82,76" fill="black" stroke="none"/>`,
  lightning: `<polygon points="112,18 52,108 96,108 80,182 150,84 106,84 128,18"/>`,
  bicycle: `<circle cx="54" cy="132" r="32"/><circle cx="146" cy="132" r="32"/><polyline points="54,132 84,80 132,80 146,132 98,132 84,80"/><line x1="74" y1="68" x2="96" y2="68"/><polyline points="132,80 126,58 142,58"/>`,
  apple: `<path d="M100 62 C62 40 28 80 44 126 C56 162 86 172 100 156 C114 172 144 162 156 126 C172 80 138 40 100 62 Z"/><path d="M100 62 Q98 44 106 30"/><path d="M108 44 Q130 26 144 42 Q124 56 108 44 Z"/>`,
  leaf: `<path d="M38 164 C38 82 100 30 166 34 C172 100 122 162 38 164 Z"/><line x1="38" y1="164" x2="140" y2="62"/><line x1="82" y1="120" x2="80" y2="90"/><line x1="104" y1="98" x2="132" y2="100"/>`,
  smile: `<circle cx="100" cy="100" r="70"/>${dot(76, 84, 8)}${dot(124, 84, 8)}<path d="M64 116 A40 40 0 0 0 136 116"/>`,
};

const FRAME = `<rect x="8" y="8" width="184" height="184" rx="26"/>`;
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${body}</svg>`;
const stroked = (width: number, body: string) =>
  `<g fill="none" stroke="black" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

/** Six variants: three per round, so More like this gets something new. */
export const VARIANTS: { name: string; draw: (subject: string) => string }[] = [
  { name: "line", draw: (s) => svg(stroked(8, SUBJECTS[s])) },
  { name: "bold", draw: (s) => svg(stroked(13, SUBJECTS[s])) },
  { name: "badge", draw: (s) => svg(stroked(8, FRAME + SUBJECTS[s])) },
  { name: "fine line", draw: (s) => svg(stroked(5, SUBJECTS[s])) },
  {
    name: "double badge",
    draw: (s) =>
      svg(
        stroked(
          6,
          `<rect x="4" y="4" width="192" height="192" rx="30"/><rect x="14" y="14" width="172" height="172" rx="22"/>` +
            SUBJECTS[s],
        ),
      ),
  },
  {
    name: "stamp",
    draw: (s) =>
      svg(
        `<rect x="6" y="6" width="188" height="188" rx="24" fill="black"/>` +
          stroked(9, SUBJECTS[s])
            .replaceAll('stroke="black"', 'stroke="white"')
            .replaceAll('fill="black"', 'fill="white"'),
      ),
  },
];

const ALIASES: Record<string, string> = {
  kitty: "cat",
  kitten: "cat",
  puppy: "dog",
  note: "music",
  bike: "bicycle",
  bolt: "lightning",
};
export function subjectKey(subject: string) {
  const words = subject.toLowerCase().split(/[^a-z]+/);
  for (const w of words) {
    if (SUBJECTS[w]) return w;
    if (ALIASES[w]) return ALIASES[w];
  }
  return "star";
}
/** A draft provider with the same contract as Claude's, drawing from the library. */
export async function libraryDrafts(input: DraftInput): Promise<DesignDraft[]> {
  const key = subjectKey(input.subject);
  const start = input.previousTitles.length;
  return Array.from({ length: input.count }, (_, k) => {
    const variant = VARIANTS[(start + k) % VARIANTS.length];
    return {
      title: `${key[0].toUpperCase()}${key.slice(1)} (${variant.name}, local library)`,
      svg: variant.draw(key),
    };
  });
}
