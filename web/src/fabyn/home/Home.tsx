// Placeholder: the seller-side agent ports the homepage hero here (web/fabyn-reference/hero.html).
import { go, ROUTES } from "../shared/nav";
export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontFamily: "var(--f-display)", fontWeight: 300 }}>fabyn</h1>
      <button onClick={() => go(ROUTES.order)}>consumer</button> <button onClick={() => go(ROUTES.seller)}>seller</button>
    </main>
  );
}
