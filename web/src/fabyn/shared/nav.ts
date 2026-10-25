import { useEffect, useState } from "react";

export const ROUTES = {
  home: "/fabyn",
  order: "/fabyn/order",
  seller: "/fabyn/seller",
} as const;

const EVENT = "fabyn:navigate";

/** Client-side navigation between the fabyn pages (the server serves all three). */
export function go(path: string) {
  if (location.pathname + location.search + location.hash === path) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new Event(EVENT));
}

export function usePathname() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const sync = () => setPath(location.pathname);
    window.addEventListener("popstate", sync);
    window.addEventListener(EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(EVENT, sync);
    };
  }, []);
  return path;
}
