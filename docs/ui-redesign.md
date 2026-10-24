# Interface redesign: minimal

Oct 23, 2026. Requester and provider screens, implemented in `web/src/App.tsx`, `web/src/styles.css` (tokens and shared components), `web/src/requester-minimal.css` and `web/src/provider-minimal.css`.

## Direction

A white page with near-black text, hairlines only where they separate content, and one filled black button per screen for the next step. The header is the wordmark and a single link to the other side of the app; there is no status bar, footer, pill navigation, tinted card or colored badge. Status is a word with a small colored dot. DM Sans stays (bundled locally); prices and counts use tabular figures.

Rules applied everywhere:

- **One primary action per state.** Everything optional is a quiet text row with a chevron.
- **Say what is happening, in one sentence.** Each order and machine has a plain-language line for what is happening now and whether it needs a person.
- **Explain disabled actions.** A disabled primary button has a visible reason under it.
- **Vocabulary for people, records for diagnostics.** Saved states (`quoted`, `release_pending`, `awaiting_owner`…) are shown as “Price ready”, “Payout confirming”, “Being prepared”. Fingerprints, specification versions, raw history and connection facts stay available in folded details.
- **Labels where they matter, not as chrome.** The global “Simulation mode · Mock payments” bar is gone. Simulation and mock status appear at the point of decision: *Local picture analysis* and *Simulated device* on the recommendation, “Mock payment · no money moves” under the price and on the payment button, *Mock record* in payments, and *Simulation* on provider orders. A lost connection still shows a small alert while it lasts.

## Requester

| State | What the person sees |
| --- | --- |
| Start | “Upload your pictures” and one dashed drop/choose area (“Add pictures · Drop or choose up to 4”). **Add a note** is a single text row. No preview, order list, machine, model or output selector. |
| Matching | The pictures sit on a soft panel with a small **Replace pictures** control above them. Beside them, “Finding the right machine…” holds the exact footprint of the result, so the controls below do not move when it arrives. Dropping new pictures anywhere on the panel replaces them. |
| Recommended | One status line (“Suitable machine found · Local picture analysis”), the output, the machine (“Sticker counter · Phomemo M02Pro · Simulated device”) and the prepared settings as one line. **Why this fits** is folded. Then the permission checkbox and **Preview your item**. |
| Clarification / unavailable | An amber status dot, the reason and the questions; **Add a note** opens with **Check again with this note** or **Check workshop again**. The preview button explains why it is waiting. |
| Preview | The actual production file, with a ruler and one caption line. Beside it: the status headline, one sentence, a four-label progress line (Preview, Payment, Making, Pickup) and **Approve preview & see price**. |
| Price | Total, “Mock payment · no money moves”, folded breakdown, collection point, reservation countdown, then the payment button. Expired prices show **Refresh expired quote**, which rechecks the same file and machine. |
| Paid → made → pickup | **Start production** stays its own step. Progress, review/failure/refund notices and the result photo follow; when ready, the pickup code comes first. |
| Recovery | Disconnection, interrupted creation, newer saved versions, private drafts, session changes and the offline service each have a notice with the one recovery action. |

**Order details** holds the order reference, date, plain status facts and the production file fingerprint/specification version; **Order history** uses readable event names with the recorded reasons. **Your orders** is a hairline list: what each order is, its status in words (including “Price expired”) and its price.

## Provider

- **Header.** “Your workshop” and one line: “3 need you · 1 in production · 1 awaiting pickup · 1 of 3 machines available”. *Need you* turns amber when work is waiting.
- **Orders.** Text tabs, then search, the view filter and pages. Each order is a hairline row: the production file, what it is, a status, one sentence (“Passed its result check. Prepare it for pickup below.”) and only then the single action form. Order details, trial costs, recovery/history and simulation controls are text links underneath.
- **Machines.** A four-part setup line (Connected → Calibrated → Listed → Available) marks the current step, with the next necessary step in words. **Machine checks** opens when a check is needed; **Settings** and **Connection details** follow.
- **Payments.** Payment collected / Payout to owner / Refund to requester, with Confirmed/Pending/Needs checking, the order, the mock/testnet mark and any transaction reference.
- **Sign in.** Heading, access code, one button.

## Mobbin references

Interaction principles only; no assets copied.

- [Microsoft Copilot](https://mobbin.com/screens/dfec08cd-925a-4145-852b-bbbdc30d3f59): one focused input on an otherwise quiet start screen.
- [Mercury review](https://mobbin.com/screens/ac38235b-cb49-4927-9966-739dd3380079): the item itself as the large canvas, facts and an explicit consent checkbox beside it, one confirm.
- [Apple order status](https://mobbin.com/screens/56dbb1a0-5db6-410b-9277-94799de12045): a status headline, one explanatory sentence and a linear progress line.
- [Shopify orders](https://mobbin.com/screens/a3746572-44e4-4a92-ab77-c4c4b9ad37dd) and [Square order management](https://mobbin.com/screens/9b7f70e1-3194-4995-b0bd-a74a3861198f): summary counts above a filtered work list.

## Contracts kept

All state, request and recovery logic is unchanged; the redesign moved markup and copy only.

- `POST /api/jobs/:id/approve-and-quote` still sends `artifactSha256`, `specVersion`, `recommendedMachineId` and optional `autoAccept` from the displayed job, and the response is still checked against that exact file, version and machine. Expired-price refresh uses the same combined call.
- Analysis and preview never pay or dispatch; payment confirmation and **Start production** remain separate deliberate buttons.
- Unknown outcomes still require saved-state checks; nothing repeats a payment, production, renewal or calibration request automatically.
- Drafts, entered values, session keys and newer-focus guards are untouched. Handling, inspection, calibration and handoff confirmations remain explicit checkboxes or codes.
- Machine availability and pickup stay independent. Simulation, mock-payment and local-analysis labels remain visible.

## Accessibility and layout

- Upload stays centered and fully visible without scrolling at 320×760 and 390×844; 16px side gutters; no horizontal scrolling from 320px to 1440px.
- Visible 2px blue focus rings; focused targets keep a 12px scroll margin so recovery notices land fully on screen.
- 44px targets for navigation, tabs, disclosures and buttons; 16px text inputs (no mobile focus zoom); reduced motion stops spinners and transitions.
- Long codes, references, reasons and statuses wrap instead of overflowing.
- Layout stability: an early Firefox pass caught a click on **Add a note** landing while the recommendation grew by about 150px. The analyzing state and the result now share one footprint; the measured shift is 0px at 320, 390, 768 and 1440px.
- Text colors meet 4.5:1 on every surface they use (muted text 5.3–6.0:1); input borders meet 3:1.

## Limitations

- Fixture screenshots use intercepted API data; the browser suites are finite software checks, not hardware or endurance evidence.
- Local picture analysis still uses limited image statistics; no live semantic vision, Claude call, funded payment or physical device was used.
- The intake heading stays “Upload your pictures” after pictures are added, because several recovery flows key on it.
- Simulation and mock status are no longer shown on the start page; they appear on the recommendation, the price and provider records. A person who never reaches those steps does not see them.
- There is no dark theme and no sticky mobile action bar; on phones the primary action follows the preview.
