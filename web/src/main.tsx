import { renderFabyn } from "./fabyn/FabynApp";
import { uiRedirect } from "../../shared/ui-routes";

// Vercel and Express redirect before serving HTML. Also handle Vite development
// and static hosts, which can fall back to index.html for these entry points.
const destination = uiRedirect(location.pathname);
if (destination)
  history.replaceState(null, "", destination + location.search + location.hash);

const root = document.getElementById("root")!;
renderFabyn(root);
