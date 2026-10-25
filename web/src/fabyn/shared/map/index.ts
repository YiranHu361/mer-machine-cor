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
   />

   Labels, pins and the route keep the same size on screen at any map width
   (the map measures itself), so the same map reads on a phone and a desktop.

   tone: "match" (orange, pulsing: the free machine that fits), "place" (our
   Palace machines), "home" (the person), "busy", "offline", "far", "type"
   (makes something else), "courier".

   World data (world.ts):
   - PALACE, HOME (Henry in Cow Hollow), ROUTE_PALACE_TO_HOME (real streets)
   - WORLD_MACHINES: display-only makers around SF (individuals, makerspaces,
     factories). Never orderable; the real machines come from the backend.
   - fitFor(machine, process, from) → { fit: free|busy|offline|far|type, note, km }
   - distanceKm, pathLengthKm, pointAlong, formatKm, PROCESS_LABEL, TOO_FAR_KM
*/
export { SFMap, BOUNDS, type MapPin, type PinTone, type Bounds, type SFMapProps } from "./SFMap";
export * from "./world";
