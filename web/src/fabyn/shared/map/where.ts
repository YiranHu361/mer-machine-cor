/* Which part of San Francisco a point is in, worked out offline: inside the
   drawn shoreline (SF_SHORE) it takes the nearest neighbourhood centre below,
   outside it is "outside San Francisco". No reverse-geocoding service. */

import { SF_SHORE, distanceKm, type LatLng } from "./world";

/** Neighbourhood centres (real coordinates, rounded). The nearest one names a point inside the city. */
export const AREAS: { name: string; at: LatLng }[] = [
  ["Presidio", 37.7989, -122.4662],
  ["Marina", 37.803, -122.438],
  ["Cow Hollow", 37.7972, -122.437],
  ["Pacific Heights", 37.7925, -122.4382],
  ["Presidio Heights", 37.788, -122.453],
  ["Sea Cliff", 37.787, -122.489],
  ["Russian Hill", 37.8011, -122.4194],
  ["Fisherman's Wharf", 37.808, -122.4177],
  ["North Beach", 37.8061, -122.4103],
  ["Telegraph Hill", 37.8025, -122.4058],
  ["Chinatown", 37.7941, -122.4078],
  ["Nob Hill", 37.793, -122.4161],
  ["Financial District", 37.7946, -122.3999],
  ["Union Square", 37.788, -122.4075],
  ["Tenderloin", 37.7847, -122.4141],
  ["SoMa", 37.7785, -122.4056],
  ["Mission Bay", 37.7706, -122.3915],
  ["Japantown", 37.7854, -122.4294],
  ["Western Addition", 37.781, -122.433],
  ["Hayes Valley", 37.7759, -122.4245],
  ["Lower Haight", 37.7717, -122.431],
  ["Haight-Ashbury", 37.7692, -122.4481],
  ["Cole Valley", 37.765, -122.45],
  ["Inner Richmond", 37.78, -122.465],
  ["Outer Richmond", 37.777, -122.495],
  ["Golden Gate Park", 37.7694, -122.4862],
  ["Inner Sunset", 37.76, -122.469],
  ["Outer Sunset", 37.755, -122.495],
  ["Parkside", 37.742, -122.488],
  ["Lakeshore", 37.728, -122.477],
  ["Forest Hill", 37.748, -122.463],
  ["West Portal", 37.7405, -122.466],
  ["Twin Peaks", 37.7544, -122.4477],
  ["Diamond Heights", 37.742, -122.44],
  ["Castro", 37.7609, -122.435],
  ["Noe Valley", 37.7502, -122.4337],
  ["Mission", 37.7599, -122.4148],
  ["Potrero Hill", 37.7605, -122.4009],
  ["Dogpatch", 37.758, -122.388],
  ["Bernal Heights", 37.739, -122.4156],
  ["Glen Park", 37.734, -122.433],
  ["Ingleside", 37.723, -122.451],
  ["Excelsior", 37.724, -122.426],
  ["Portola", 37.727, -122.406],
  ["Bayview", 37.73, -122.388],
  ["Hunters Point", 37.727, -122.371],
  ["Visitacion Valley", 37.713, -122.408],
].map(([name, lat, lng]) => ({ name: name as string, at: { lat: lat as number, lng: lng as number } }));

/** Ray casting: is the point inside the polygon? */
export function insidePolygon(p: LatLng, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

export const inSanFrancisco = (p: LatLng) => insidePolygon(p, SF_SHORE);

/** The neighbourhood a point is in, or null outside San Francisco. */
export function areaOf(p: LatLng): string | null {
  if (!inSanFrancisco(p)) return null;
  let best = AREAS[0];
  let bestKm = Infinity;
  for (const a of AREAS) {
    const km = distanceKm(p, a.at);
    if (km < bestKm) {
      best = a;
      bestKm = km;
    }
  }
  return best.name;
}

/** "Mission", or "outside San Francisco". */
export const areaLabel = (p: LatLng) => areaOf(p) ?? "outside San Francisco";
