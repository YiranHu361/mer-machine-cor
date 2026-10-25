import { createRoot } from "react-dom/client";
import App from "./App";
import { LiveProvider } from "./live";
import "@fontsource-variable/dm-sans";
import "./styles.css";
import "./requester-minimal.css";
import "./provider-minimal.css";
import "./make.css";

export function renderLegacy(container: HTMLElement) {
  createRoot(container).render(
    <LiveProvider>
      <App />
    </LiveProvider>,
  );
}
