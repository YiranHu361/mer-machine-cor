/**
 * Deterministic stand-in drafts for tests and isolated end-to-end runs
 * (FABYN_DESIGN_PROVIDER=fixture). They are labelled as fixture drafts and
 * never presented as generated artwork.
 */
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${body}</svg>`;
const S =
  'fill="none" stroke="black" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';
const CAT = [
  {
    title: "Cat face outline",
    svg: svg(
      `<path ${S} d="M40 70 L55 25 L85 55 Q100 50 115 55 L145 25 L160 70 Q175 110 150 145 Q100 185 50 145 Q25 110 40 70 Z"/><circle cx="78" cy="98" r="9" fill="black"/><circle cx="122" cy="98" r="9" fill="black"/><path ${S} d="M92 122 L100 130 L108 122"/><line ${S} x1="30" y1="112" x2="70" y2="118"/><line ${S} x1="130" y1="118" x2="170" y2="112"/>`,
    ),
  },
  {
    title: "Curled-up cat",
    svg: svg(
      `<path ${S} d="M40 140 Q30 80 90 70 Q150 62 165 110 Q175 150 130 160 L60 160 Q35 160 40 140 Z"/><path ${S} d="M60 160 Q30 175 25 150 Q20 130 40 125"/><path ${S} d="M120 70 L128 45 L142 72"/><path ${S} d="M98 72 L104 48 L118 70"/><path ${S} d="M118 100 Q125 106 132 100"/>`,
    ),
  },
  {
    title: "Playful cat",
    svg: svg(
      `<circle ${S} cx="100" cy="105" r="62"/><path ${S} d="M52 70 L60 28 L90 48"/><path ${S} d="M148 70 L140 28 L110 48"/><path ${S} d="M70 100 Q80 88 90 100"/><path ${S} d="M110 100 Q120 88 130 100"/><path ${S} d="M85 130 Q100 145 115 130"/><ellipse cx="100" cy="120" rx="6" ry="4" fill="black"/>`,
    ),
  },
];
const HEART = [
  {
    title: "Heart outline",
    svg: svg(
      `<path ${S} d="M100 170 L35 100 Q10 70 35 45 Q65 20 100 60 Q135 20 165 45 Q190 70 165 100 Z"/>`,
    ),
  },
  {
    title: "Double heart",
    svg: svg(
      `<path ${S} d="M90 160 L35 105 Q15 80 37 58 Q62 36 90 70 Q118 36 143 58 Q165 80 143 105 Z"/><path ${S} d="M150 120 L125 95 Q115 82 127 72 Q140 62 150 78 Q160 62 173 72 Q185 82 175 95 Z"/>`,
    ),
  },
  {
    title: "Heart badge",
    svg: svg(
      `<circle ${S} cx="100" cy="100" r="80"/><path d="M100 150 L60 108 Q45 90 60 74 Q80 58 100 82 Q120 58 140 74 Q155 90 140 108 Z" fill="black"/>`,
    ),
  },
];
const BADGE = [
  {
    title: "Round badge",
    svg: svg(
      `<circle ${S} cx="100" cy="100" r="80"/><circle ${S} cx="100" cy="100" r="55"/><path ${S} d="M70 100 L92 122 L132 80"/>`,
    ),
  },
  {
    title: "Star badge",
    svg: svg(
      `<polygon ${S} points="100,20 122,75 180,78 135,115 150,172 100,140 50,172 65,115 20,78 78,75"/>`,
    ),
  },
  {
    title: "Ribbon badge",
    svg: svg(
      `<circle ${S} cx="100" cy="80" r="55"/><path ${S} d="M70 125 L55 185 L85 168 L100 190 L115 168 L145 185 L130 125"/>`,
    ),
  },
];
export function fixtureDrafts(subject: string, round: number, count: number) {
  const set = /cat|kitten/.test(subject)
    ? CAT
    : /heart|love/.test(subject)
      ? HEART
      : BADGE;
  // A later round rotates the order so "More like this" shows a different first draft.
  const rotated = [
    ...set.slice(round % set.length),
    ...set.slice(0, round % set.length),
  ];
  return rotated.slice(0, count).map((d) => ({
    title: `${d.title} (fixture)`,
    svg: d.svg,
  }));
}
