// The fabyn experience (/fabyn, /fabyn/order, /fabyn/seller) and the existing app load
// separately, so neither one's global styles reach the other.
const root = document.getElementById("root")!;
if (location.pathname.startsWith("/fabyn"))
  import("./fabyn/FabynApp").then(({ renderFabyn }) => renderFabyn(root));
else import("./legacy").then(({ renderLegacy }) => renderLegacy(root));
