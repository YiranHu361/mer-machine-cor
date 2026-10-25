/* The San Francisco the fabyn map draws, in real coordinates (WGS84 lat/lng).

   Geometry is simplified from the real shoreline, parks and main streets so it
   reads as SF at a glance. The Palace of Fine Arts machines are the real ones
   (the backend's machines); everything in WORLD_MACHINES is display-only:
   other makers around the city that make the network feel lived in. They are
   never orderable. */

export type LatLng = { lat: number; lng: number };
export type Process = "fdm_print" | "sticker_print" | "photo_print" | "resin_print" | "laser_cut";

export const PALACE: LatLng & { label: string; short: string } = {
  lat: 37.8029,
  lng: -122.4484,
  label: "Palace of Fine Arts, San Francisco",
  short: "Palace of Fine Arts",
};

/** Where the consumer (Henry) is: Cow Hollow, a short ride from the Palace. */
export const HOME: LatLng & { label: string; short: string; person: string } = {
  lat: 37.7979,
  lng: -122.4357,
  label: "Union St & Fillmore St, Cow Hollow",
  short: "Cow Hollow",
  person: "Henry",
};

/** Real street path from the Palace to Henry: Lyon St, Lombard St, Fillmore St. */
export const ROUTE_PALACE_TO_HOME: LatLng[] = [
  { lat: 37.8029, lng: -122.4484 },
  { lat: 37.8018, lng: -122.4472 },
  { lat: 37.8004, lng: -122.4469 },
  { lat: 37.7994, lng: -122.4466 },
  { lat: 37.7996, lng: -122.4420 },
  { lat: 37.7998, lng: -122.4357 },
  { lat: 37.7979, lng: -122.4357 },
];

export type MakerKind = "individual" | "makerspace" | "small factory" | "factory";
export type MakerStatus = "busy" | "offline" | "idle";

export interface WorldMachine {
  id: string;
  /** who runs it: a person or a shop */
  owner: string;
  kind: MakerKind;
  model: string;
  process: Process;
  /** how many machines of this kind they run */
  count: number;
  hood: string;
  at: LatLng;
  status: MakerStatus;
  /** jobs ahead of a new one, when busy */
  queue?: number;
  /** minutes until the next slot opens, when busy */
  nextFreeMin?: number;
}

export const WORLD_MACHINES: WorldMachine[] = [
  { id: "w_sam", owner: "Sam K.", kind: "individual", model: "Bambu Lab A1", process: "fdm_print", count: 1, hood: "Marina", at: { lat: 37.8008, lng: -122.4385 }, status: "busy", queue: 3, nextFreeMin: 55 },
  { id: "w_pier9", owner: "Pier 9 Workshop", kind: "factory", model: "Bambu Lab X1C ×6", process: "fdm_print", count: 6, hood: "Embarcadero", at: { lat: 37.801, lng: -122.399 }, status: "busy", queue: 11, nextFreeMin: 140 },
  { id: "w_tide", owner: "Tidewater Fab", kind: "small factory", model: "Prusa MK4 ×4", process: "fdm_print", count: 4, hood: "Mission", at: { lat: 37.7605, lng: -122.412 }, status: "busy", queue: 7, nextFreeMin: 95 },
  { id: "w_priya", owner: "Priya N.", kind: "individual", model: "Prusa MK4", process: "fdm_print", count: 1, hood: "Noe Valley", at: { lat: 37.7505, lng: -122.432 }, status: "offline" },
  { id: "w_kenji", owner: "Kenji T.", kind: "individual", model: "Bambu Lab P1S", process: "fdm_print", count: 1, hood: "Outer Sunset", at: { lat: 37.755, lng: -122.495 }, status: "idle" },
  { id: "w_hill", owner: "Hilltop Plastics", kind: "small factory", model: "Bambu Lab P1S ×3", process: "fdm_print", count: 3, hood: "Potrero Hill", at: { lat: 37.7598, lng: -122.4005 }, status: "busy", queue: 5, nextFreeMin: 70 },
  { id: "w_gray", owner: "Gray Area makers", kind: "makerspace", model: "Ender 3 ×2", process: "fdm_print", count: 2, hood: "SoMa", at: { lat: 37.777, lng: -122.406 }, status: "busy", queue: 4, nextFreeMin: 60 },
  { id: "w_dog", owner: "Dogpatch Works", kind: "factory", model: "Bambu Lab X1E ×8", process: "fdm_print", count: 8, hood: "Dogpatch", at: { lat: 37.758, lng: -122.389 }, status: "idle" },
  { id: "w_ana", owner: "Ana R.", kind: "individual", model: "Creality Ender 3", process: "fdm_print", count: 1, hood: "Inner Richmond", at: { lat: 37.78, lng: -122.465 }, status: "offline" },
  { id: "w_ucsf", owner: "Parnassus makerlab", kind: "makerspace", model: "Prusa XL", process: "fdm_print", count: 1, hood: "Inner Sunset", at: { lat: 37.763, lng: -122.458 }, status: "offline" },
  { id: "w_olivia", owner: "Olivia P.", kind: "individual", model: "Formlabs Form 4", process: "resin_print", count: 1, hood: "Pacific Heights", at: { lat: 37.792, lng: -122.433 }, status: "idle" },
  { id: "w_leo", owner: "Leo M.", kind: "individual", model: "Brother QL-820", process: "sticker_print", count: 1, hood: "Haight", at: { lat: 37.7695, lng: -122.446 }, status: "busy", queue: 2, nextFreeMin: 25 },
  { id: "w_nbpaper", owner: "North Beach Paper Co", kind: "small factory", model: "Phomemo M04S ×2", process: "sticker_print", count: 2, hood: "North Beach", at: { lat: 37.801, lng: -122.411 }, status: "busy", queue: 6, nextFreeMin: 45 },
  { id: "w_mei", owner: "Mei W.", kind: "individual", model: "instax Link Wide", process: "photo_print", count: 1, hood: "Chinatown", at: { lat: 37.7945, lng: -122.4065 }, status: "busy", queue: 1, nextFreeMin: 20 },
  { id: "w_bayprint", owner: "Bay Print Co", kind: "factory", model: "label + photo line", process: "photo_print", count: 5, hood: "Bayview", at: { lat: 37.733, lng: -122.392 }, status: "idle" },
  { id: "w_laser", owner: "Mission Laser Lab", kind: "small factory", model: "Glowforge Pro ×2", process: "laser_cut", count: 2, hood: "Mission", at: { lat: 37.7565, lng: -122.4185 }, status: "idle" },
];

/** Past this distance from the person a free machine counts as too far for same-day pickup or a bike courier. */
export const TOO_FAR_KM = 4;

export const PROCESS_LABEL: Record<Process, string> = {
  fdm_print: "3D printer",
  sticker_print: "sticker printer",
  photo_print: "photo printer",
  resin_print: "resin 3D printer",
  laser_cut: "laser cutter",
};

/* ---------- geometry ---------- */

const P = (lat: number, lng: number): LatLng => ({ lat, lng });

/** The city, clockwise from Fort Point under the Golden Gate Bridge. */
export const SF_SHORE: LatLng[] = [
  P(37.8106, -122.4771), P(37.807, -122.472), P(37.8048, -122.466), P(37.8053, -122.456),
  P(37.8065, -122.448), P(37.8076, -122.442), P(37.8072, -122.437), P(37.8085, -122.432),
  P(37.8077, -122.426), P(37.8085, -122.421), P(37.81, -122.416), P(37.8095, -122.4095),
  P(37.8065, -122.404), P(37.802, -122.399), P(37.7975, -122.3945), P(37.7905, -122.388),
  P(37.784, -122.387), P(37.778, -122.3875), P(37.77, -122.3865), P(37.762, -122.384),
  P(37.752, -122.383), P(37.744, -122.378), P(37.738, -122.37), P(37.73, -122.364),
  P(37.725, -122.358), P(37.719, -122.364), P(37.713, -122.377), P(37.708, -122.388),
  P(37.7082, -122.45), P(37.7085, -122.502), P(37.72, -122.504), P(37.735, -122.507),
  P(37.752, -122.51), P(37.768, -122.511), P(37.779, -122.514), P(37.786, -122.506),
  P(37.788, -122.495), P(37.7905, -122.486), P(37.796, -122.484), P(37.803, -122.483),
];

/** The Marin Headlands across the Golden Gate, and Treasure / Yerba Buena islands. */
export const OTHER_LAND: LatLng[][] = [
  [P(37.85, -122.53), P(37.8335, -122.53), P(37.832, -122.5), P(37.8285, -122.486), P(37.8255, -122.479), P(37.8295, -122.471), P(37.8345, -122.468), P(37.85, -122.46)],
  [P(37.8165, -122.3725), P(37.8315, -122.3735), P(37.832, -122.3615), P(37.8165, -122.3605)],
  [P(37.8095, -122.369), P(37.8135, -122.3635), P(37.8085, -122.3585), P(37.805, -122.365)],
];

export const PARKS: { name: string; shape: LatLng[] }[] = [
  {
    name: "Golden Gate Park",
    shape: [P(37.7735, -122.5108), P(37.7735, -122.4545), P(37.7733, -122.447), P(37.7718, -122.447), P(37.772, -122.4545), P(37.7655, -122.4545), P(37.7655, -122.5108)],
  },
  {
    name: "Presidio",
    shape: [P(37.8045, -122.4775), P(37.8048, -122.4485), P(37.7995, -122.4472), P(37.788, -122.4472), P(37.7872, -122.472), P(37.7905, -122.486), P(37.803, -122.483)],
  },
  {
    name: "Lake Merced",
    shape: [P(37.7335, -122.4935), P(37.7315, -122.4855), P(37.7235, -122.4845), P(37.7195, -122.4915), P(37.7245, -122.4985)],
  },
];

/** Main streets, drawn faint. */
export const STREETS: { name: string; path: LatLng[] }[] = [
  { name: "Lombard St", path: [P(37.799, -122.447), P(37.7998, -122.4357), P(37.8021, -122.4188)] },
  { name: "Van Ness Ave", path: [P(37.8045, -122.4247), P(37.775, -122.4195)] },
  { name: "Market St", path: [P(37.7955, -122.3937), P(37.779, -122.4155), P(37.7695, -122.4295), P(37.7625, -122.435), P(37.7525, -122.447)] },
  { name: "Geary Blvd", path: [P(37.7875, -122.4065), P(37.785, -122.433), P(37.7815, -122.465), P(37.7795, -122.51)] },
  { name: "19th Ave", path: [P(37.8045, -122.4745), P(37.786, -122.472), P(37.765, -122.4768), P(37.73, -122.475), P(37.7085, -122.4722)] },
  { name: "Divisadero St", path: [P(37.8, -122.4425), P(37.77, -122.437)] },
  { name: "Mission St", path: [P(37.787, -122.401), P(37.7705, -122.42), P(37.74, -122.4215), P(37.7085, -122.4605)] },
  { name: "US 101", path: [P(37.7705, -122.4085), P(37.744, -122.4045), P(37.722, -122.396), P(37.7085, -122.392)] },
  // the Marina and Cow Hollow grid around the Palace, for the close-up delivery map
  { name: "Marina Blvd", path: [P(37.8058, -122.4478), P(37.8066, -122.4425), P(37.8062, -122.4362), P(37.8068, -122.4323)] },
  { name: "Bay St", path: [P(37.8031, -122.4475), P(37.8043, -122.4364), P(37.8054, -122.4235)] },
  { name: "Chestnut St", path: [P(37.8008, -122.4469), P(37.8018, -122.4372), P(37.8036, -122.4237)] },
  { name: "Union St", path: [P(37.7973, -122.4466), P(37.7980, -122.4357), P(37.7997, -122.4228)] },
  { name: "Broadway", path: [P(37.7944, -122.4462), P(37.7962, -122.4326), P(37.7973, -122.4225)] },
  { name: "Lyon St", path: [P(37.8029, -122.4484), P(37.8018, -122.4472), P(37.7994, -122.4466), P(37.7880, -122.4460)] },
  { name: "Fillmore St", path: [P(37.8055, -122.4363), P(37.7979, -122.4357), P(37.7850, -122.4330)] },
  { name: "Steiner St", path: [P(37.8050, -122.4378), P(37.7980, -122.4373), P(37.7860, -122.4350)] },
  { name: "Laguna St", path: [P(37.8063, -122.4320), P(37.7985, -122.4306), P(37.7870, -122.4282)] },
  { name: "Golden Gate Bridge", path: [P(37.8106, -122.4771), P(37.8285, -122.4795)] },
  { name: "Bay Bridge", path: [P(37.788, -122.388), P(37.8085, -122.3645)] },
];

export const HOODS: { name: string; at: LatLng }[] = [
  { name: "marina", at: P(37.8040, -122.4400) },
  { name: "cow hollow", at: P(37.7990, -122.4395) },
  { name: "presidio", at: P(37.7975, -122.4655) },
  { name: "pacific heights", at: P(37.7905, -122.4345) },
  { name: "north beach", at: P(37.7995, -122.4095) },
  { name: "chinatown", at: P(37.7935, -122.4045) },
  { name: "soma", at: P(37.7785, -122.4025) },
  { name: "mission", at: P(37.7595, -122.4165) },
  { name: "noe valley", at: P(37.7495, -122.4335) },
  { name: "haight", at: P(37.7705, -122.4485) },
  { name: "richmond", at: P(37.7805, -122.4845) },
  { name: "sunset", at: P(37.7535, -122.4905) },
  { name: "golden gate park", at: P(37.7695, -122.4835) },
  { name: "dogpatch", at: P(37.7585, -122.3875) },
  { name: "bayview", at: P(37.7305, -122.3885) },
  { name: "potrero hill", at: P(37.7605, -122.3985) },
];

/* ---------- maths ---------- */

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function pathLengthKm(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceKm(path[i - 1], path[i]);
  return total;
}

/** The point a fraction t (0..1) of the way along a path. */
export function pointAlong(path: LatLng[], t: number): LatLng {
  if (path.length === 0) return PALACE;
  if (path.length === 1 || t <= 0) return path[0];
  if (t >= 1) return path[path.length - 1];
  const total = pathLengthKm(path);
  let want = total * t;
  for (let i = 1; i < path.length; i++) {
    const seg = distanceKm(path[i - 1], path[i]);
    if (want <= seg) {
      const f = seg === 0 ? 0 : want / seg;
      return {
        lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * f,
        lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * f,
      };
    }
    want -= seg;
  }
  return path[path.length - 1];
}

export const formatKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

export type Fit = "free" | "busy" | "offline" | "far" | "type";

/** How one display-only maker machine fits a request for a process, seen from where the person is. */
export function fitFor(m: WorldMachine, process: Process | null, from: LatLng = HOME): { fit: Fit; note: string; km: number } {
  const km = distanceKm(from, m.at);
  if (process && m.process !== process) return { fit: "type", note: `makes ${PROCESS_LABEL[m.process]} jobs`, km };
  if (m.status === "offline") return { fit: "offline", note: "offline", km };
  if (m.status === "busy")
    return { fit: "busy", note: `busy · ${m.queue ?? 1} in queue · free in about ${m.nextFreeMin ?? 30} min`, km };
  if (km > TOO_FAR_KM) return { fit: "far", note: `free, but ${formatKm(km)} away`, km };
  return { fit: "free", note: "free", km };
}
