import { createRoot } from "react-dom/client";
import "@fontsource/michroma";
import "@fontsource-variable/archivo";
import "@fontsource/martian-mono/300.css";
import "@fontsource/martian-mono/400.css";
import "./shared/tokens.css";
import { ROUTES, usePathname } from "./shared/nav";
import Home from "./home/Home";
import ConsumerApp from "./consumer/ConsumerApp";
import SellerApp from "./seller/SellerApp";

function FabynApp() {
  const path = usePathname().replace(/\/+$/, "") || ROUTES.home;
  if (path.startsWith(ROUTES.order)) return <ConsumerApp />;
  if (path.startsWith(ROUTES.seller)) return <SellerApp />;
  return <Home />;
}

export function renderFabyn(container: HTMLElement) {
  document.title = "fabyn";
  createRoot(container).render(<FabynApp />);
}
