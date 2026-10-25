/* fabyn shared map: one San Francisco for the consumer and seller pages.

   API (keep stable; consumer and seller both import from here):

   <SFMap
     pins={MapPin[]}          // { id, at: {lat,lng}, label, sub?, tone, interactive?, showLabel?, labelAt?: "left"|"right" }
     route?={LatLng[]}        // drawn dashed; the travelled part turns orange
     progress?={0..1}         // moving marker along the route (courier)
     markerLabel?="Rosa · e-bike"
     bounds?={BOUNDS.city | BOUNDS.north | BOUNDS.palace | custom}
     selectedId?={string}
     onSelect?={(id) => …}    // only pins with interactive: true call it
     label="accessible name"
     onPick?={(at) => …}      // tap-to-set: a tap off the pins gives that spot's lat/lng
   />

   boundsAround(points, { minKm?, pad?, within? }) frames points inside the city;
   a pin outside the bounds is drawn on the map edge with an arrow toward it.
   where.ts: areaOf(p) / areaLabel(p) name the neighbourhood offline (nearest of
   AREAS inside SF_SHORE), "outside San Francisco" otherwise.

   Labels, pins and the route keep the same size on screen at any map width
   (the map measures itself), so the same map reads on a phone and a desktop.

   tone: "match" (orange, pulsing: the free machine that fits), "place" (our
   Palace machines), "home" (the person), "busy", "offline", "far", "type"
   (makes something else), "courier".

   World data (world.ts):
   - PALACE; HOME and ROUTE_PALACE_TO_HOME are a fixed stand-in the seller pages still
     use. The consumer uses the person's real location (consumer/location.ts) instead.
   - WORLD_MACHINES: display-only makers around SF (individuals, makerspaces,
     factories). Never orderable; the real machines come from the backend.
   - fitFor(machine, process, from) → { fit: free|busy|offline|far|type, note, km }
   - distanceKm, pathLengthKm, pointAlong, formatKm, PROCESS_LABEL, TOO_FAR_KM
*/
export { SFMap, BOUNDS, boundsAround, inBounds, type MapPin, type PinTone, type Bounds, type SFMapProps } from "./SFMap";
export * from "./world";
export * from "./where";
