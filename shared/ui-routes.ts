export const UI_ROUTES = {
  home: "/fabyn",
  order: "/fabyn/order",
  seller: "/fabyn/seller",
} as const;

// Retired entry points always lead into the current Fabyn interface.
export const UI_REDIRECTS: Readonly<Record<string, string>> = {
  "/": UI_ROUTES.home,
  "/index.html": UI_ROUTES.home,
  "/owner": UI_ROUTES.seller,
  "/make": UI_ROUTES.order,
  "/relief": UI_ROUTES.home,
  "/live": UI_ROUTES.home,
};

export function uiRedirect(pathname: string): string | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  return Object.hasOwn(UI_REDIRECTS, path) ? UI_REDIRECTS[path] : undefined;
}
