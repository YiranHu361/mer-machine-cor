# Consumer chat and shared delivery: design

Date: 2026-10-25. Branch `UI/UX`. Decided by Henry:

- The consumer page becomes one chat box. It uses the existing order API; there is no new chat endpoint.
- Delivery choice, the customer's location and the courier live on the server, so the consumer and the seller see the same courier and ETA.

## 1. Consumer chat (`/fabyn/order`)

**One thread per order.** The entry page is a chat box with an attach button (photos) and three suggestion chips. The chips replace today's three modes:
- "use my name (Henry)" fills `A keychain that says "Henry"`.
- "print my photo" opens the file picker.
- "a three-piece gift" toggles `experience: "gift"`.

**First message:** `POST /orders` with the text, any photos and the experience. Everything after that happens in the same thread.

**Agent turns** are written from the real order state, never invented:
- understanding: `intent.outcome`, the matched machine type (`MATCH_OF_PROCESS`), and `intent.question` when the server asks one;
- drawing: the print-simulator wait (Stage3D) while candidates are generating;
- failure: `plainReason(...)`.

Prices, machines, times and codes come only from the order view.

**Cards in the thread.** Each step is a card with the content of today's step. The newest card is live. Older cards collapse to a one-line summary that can be opened again. The cards, in order:
1. Matched machine: the type, the Palace of Fine Arts machine with its owner, current job and queue.
2. Makers nearby: the map. The location is asked here; this is the location work that is already done.
3. Drafts: three tappable drafts, plus "more like this".
4. Preview: the real render, size, price and the add/replace suggestions.
5. Queue.
6. Checkout: the built-in test wallet and the BaseScan receipt.
7. Printing.
8. Get it: pickup or delivery.

The eight-step rail shrinks to a thin progress strip above the thread.

**Follow-up messages before checkout** go to `PATCH /orders/:id/draft`:
- body: `{expectedRevision, requestText: previous + "\n" + message}`;
- photos: new ones are uploaded and added, if `editDraft` accepts `photoAssetIds`;
- result: the server understands again and draws new drafts, which arrive as a new drafts card.

**After the order is confirmed,** the box stops accepting changes and says so ("This order is paid. Start a new one to change it."). Only the pickup/delivery chips stay available.

**The thread is kept** in `sessionStorage` under `fabyn.chat.<orderId>`. Opening an order from "my orders" without a saved thread starts with `draft.requestText` as the first message and rebuilds the cards from the order state.

**Rules that still hold:**
- Never show "demo", "simulated" or "simulation".
- Works at phone width; the chat box is pinned to the bottom with safe-area padding.
- Waiting moments use the print simulator.

## 2. Conversation-aware understanding (server)

A multi-line `requestText` is a conversation, and later lines override earlier ones.

- **Claude:** the `understandRequest` system prompt (`integrations/src/claude.ts`) gets one sentence saying so.
- **Local rules** (`server/orchestration/intent.ts`): `localIntent` reads the process, name and subject from the latest line that states them, and falls back to earlier lines. For example, `A keychain that says "Henry"` followed by `make it say Lucas` gives "Lucas".

## 3. Shared delivery (server + seller + consumer)

**Order view field `delivery`** (absent until the customer chooses):

```ts
delivery?: {
  mode: "pickup" | "delivery";
  to?: { lat: number; lng: number; label: string; source: "gps" | "map" }; // delivery only; lat/lng rounded to 4 decimals
  km: number | null;            // street-route km if the client had one, else null
  chosenAt: string;             // ISO
  courier?: {
    name: string;               // from a fixed list on the server, picked by the order id
    vehicle: string;
    calledAt: string;           // ISO, when the owner pressed "Call a courier"
    pickupAt: string;           // ISO estimate: calledAt + 6 min to reach the workshop + 1 min handover
    arriveAt: string;           // ISO estimate: pickupAt + max(5, 2.4 min per km)
  };
}
```

**Phase** is derived from the times, the same on both sides:
- now < pickupAt: going to the workshop;
- pickupAt ≤ now < arriveAt: picked up, on the way;
- now ≥ arriveAt: delivered.

**Requester endpoint:** `POST /api/orders/:id/delivery` with `{mode, to?, km?}`.
- Only the order's own session can call it.
- `to` is required for `delivery`, with a finite lat/lng and a label of at most 60 characters.
- Changing the mode is refused once a courier is called or an item is collected.
- It adds one event. The background tick never writes to it.

**Owner endpoint:** `POST /api/owner/orders/:id/courier` with `{}`.
- Allowed only for a `delivery` order whose items are made.
- It is idempotent: a second call returns the same courier and times.

**Owner dashboard:** shows each order's `delivery`: the mode, the `to.label`, km and courier. The exact lat/lng appears only for delivery orders.

**Seller Delivery tab** reads and writes through these endpoints instead of `localStorage`:
- "With a courier" shows the server courier, its phase and the ETA.
- The customer's neighbourhood replaces "Henry's door".
- Pickup orders keep the pickup-code flow.

**Consumer "get it" card:**
- Choosing pickup or delivery posts the choice.
- Once a courier is called, the card shows "<name> picked up your order at <time>" (or "is on the way to the workshop"), the km left, "arrives about <time> (<n> min)" and the dot moving on the street route.
- Until the owner calls a courier, it says the seller will send one when the order is made.

## Testing

- **Server:** unit and route tests for both endpoints (auth, validation, idempotency, mode lock), for the view field and for the conversation-aware local intent. `npm test` and the typecheck must pass.
- **Web:** run Playwright against the backend in build mode (fixture drafts, no paid calls) on desktop and phone:
  - a name keychain, then a follow-up that renames it;
  - a cat sticker, then "make it wear a hat", which gives a second drafts card;
  - a photo print;
  - a delivery to Mission, with the owner calling the courier from a second browser context; both sides must show the same name and ETA;
  - a pickup.
