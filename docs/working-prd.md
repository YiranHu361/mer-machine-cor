# Fabrary: PRD, Design Doc and Feasibility
Oct 22, 2026 · @Yiran

## Summary

Fabrary starts with pictures. The requester uploads images, and the agent recommends a suitable physical output and a machine from the registered database, using the pictures and each machine's capabilities, loaded material and current availability. The requester does not need to choose a machine, output type or production settings first. They review the recommendation, approve a production preview and an itemized quote, then get a photo of the result and a pickup code. An owner connects a supported machine to a node, sets prices and hours, and receives jobs through one common interface.
The Cal Hacks build runs this loop on the team's three machines. Stickers on the Phomemo M02Pro are the main interactive demo, the Instax Mini Link 3 is the second output, and a short prepared print on the Bambu Lab A1 mini shows the same orchestration on a longer job. Known-device onboarding is shown live. Photo-to-3D and adapter generation for unfamiliar models stay visible stretch goals.
The requester view has no output-type cards, machine selector or prepared-model chooser, including inside optional settings. The first screen centers on uploading pictures; machine identity and capabilities appear only after analysis as a read-only recommendation. Optional size, crop, quantity, rights review and budget refinements cannot silently remove or switch a recommended machine. Replacing pictures or changing their purpose on new-order or machine-bound drafts requires a fresh match before previewing. Existing reviewed prepared-3D records remain supported outside this image intake.

The implemented interface starts with one upload target and no empty preview or order list. Pictures then sit beside the prepared recommendation; **Add a note** and **Optional print settings** stay secondary. Each order shows its status in plain words, one sentence about what is happening and one primary next action, with fingerprints, specification versions and raw states in folded details. The provider workspace is a work inbox with **Orders**, **Machines** and **Payments** tabs, opening with one summary line of work that needs a person, a one-sentence next step per order and a setup line per machine. Simulation and mock labels appear at the recommendation, price and provider records instead of a global bar. Providers still explicitly confirm physical work; fewer visible controls do not imply automatic inspection or handling. Design decisions are recorded in [ui-redesign.md](ui-redesign.md).

The minimalism pass uses [Microsoft Copilot’s start screen](https://mobbin.com/screens/dfec08cd-925a-4145-852b-bbbdc30d3f59) for one primary input and quiet navigation, and [Square’s order list](https://mobbin.com/screens/9b7f70e1-3194-4995-b0bd-a74a3861198f) for a provider inbox with secondary filters. The app owns capability matching, preparation, quoting and status updates; people review the preview/payment and confirm physical work. Details open when needed instead of making every user complete setup fields up front.

Design references inspected on Mobbin: [Square image upload](https://mobbin.com/screens/610ae606-5a0f-43d0-9787-9a5dfd893f8d) for a focused upload target and concise action hierarchy; [Recraft image review](https://mobbin.com/screens/df0d6d5b-2ebe-478d-be27-56dd738f7a07) for an image-led canvas with supporting details alongside it. Adapt those hierarchy principles to Fabrary's existing blue/ink/paper workshop identity; no reference assets are copied.

The platform automates intake, preparation, matching, payment tracking, dispatch and visible-output checks. Owners still load media, clear machines, remove finished items and hand them off. The demo uses team-operated machines and test funds. Submission closes Sunday, October 25 at 9 AM PT, as the organizers' October 22 email states; the product name is still open.

## Product requirements (PRD)


### Problem and first users

Our first customer hypothesis is that Berkeley students and clubs want small quantities of personalized items quickly, without quoting and setup. Our first supply hypothesis is that owners will accept standardized jobs when the price covers consumables, handling and failures.
The hackathon proves the transaction and the machine interface. Two or three conversations with club officers should establish a recent need, acceptable material and finish, pickup distance, turnaround and willingness to pay, and one prospective owner should describe the work between orders.

| User | Gives Fabrary | Receives | Still does |
| --- | --- | --- | --- |
| Requester | 1 to 4 images, explicit artwork permission, an approved preview; optional note, print refinements and budget | Recommended result and machine, itemized quote, job progress, result photo, pickup code | Reviews the output, confirms payment and production, and collects the item |
| Owner | A supported connected machine, loaded media, price card, hours, content rules | Standardized jobs, a status dashboard, a payout record | Prepares the machine, reloads media, clears outputs, handles collection and exceptions |


### Scope and delivery order

All three machines stay target deliverables. This order protects a complete demo while hardware and integrations are added.

| Level | Deliverable | Acceptance condition |
| --- | --- | --- |
| P0 | Complete sticker transaction | Upload, structured spec, approved preview, quote, payment adapter, dispatch, result check, pickup code |
| P0 | Registry and owner controls | Capability manifest, current availability, one active job per device, pause and resume |
| P0 | Recoverable job execution | Persisted state, repeated-request protection, visible errors, no automatic reprint after an uncertain dispatch |
| P0 | Known-device onboarding | A supported, already connected device registers and calibrates through the node app |
| P1 | Instax output | Reuses the same transaction and status flow after a passing Link 3 hardware test |
| P1 | Prepared 3D output | Starts a short, pre-sliced single-color model through the same job interface and records completion and evidence |
| P1 | x402 on Base Sepolia | Collection, held test balance, release and refund paths, each with receipts |
| P1 | Fetch.ai discovery | A real discoverable agent path into the authorized job flow |
| P1 | Owner dashboard | Jobs, media status or owner-entered estimates, handling tasks, test payouts |
| P2 | Other sponsor integrations | Ship independently once the physical loop is stable and an owner is free |
| P2 | Photo to 3D | Decorative objects only, with model approval and an asynchronous preparation step |
| P2 | Unfamiliar-machine onboarding | One supervised, rehearsed example; discovered adapters enter review before reuse |

Out of scope for the hackathon: real customer funds, real postage, a public owner marketplace, multicolor 3D, functional parts with tolerances, ratings, mobile apps, lasers and CNC. A test shipping label may follow once pickup works.

### Requester flow

1. Upload 1 to 4 images into one upload target. The agent recommends an output and a suitable registered machine, explains the choice and fills supported dimensions, material, crop and a default quantity of one. **Add a note** and **Optional print settings** offer secondary refinements after upload; neither is an intake requirement. Ask a short bundled clarification only when the pictures leave an essential choice unresolved. If vision is unavailable, identify limited local analysis honestly; if no suitable machine is available, say so without silently choosing an unsuitable output. Empty preview and order-history panels are absent until there is content to show.
2. Confirm artwork permission explicitly and select **Preview your item**. If permission is uncertain, explicitly request owner review instead of inferring permission from the pictures. Inspect the production preview with dimensions, crop, material and color limits. A thermal sticker preview shows the actual monochrome conversion.
3. Select **Approve preview & see price**. Fabrary atomically approves the displayed file/specification, rechecks the recommended machine, reserves it briefly, and quotes consumables, machine time, owner handling, platform fee, an expiry and the collection point. A failed quote cannot leave a newly approved intermediate state. A different machine requires a fresh recommendation and approval instead of a silent switch. The demo uses one designated collection point.
4. Confirm the displayed mock or testnet payment separately. With a configured budget mandate, the agent may accept a quote for an already approved specification within that mandate; this never substitutes for checkout consent. Any change to price or output needs new approval.
5. Select **Start production** after payment is confirmed. The approved artifact is dispatched only by this deliberate action. The requester sees payment, machine progress, verification and any owner action needed; analysis, preview creation and preview approval do not start a machine.
6. A passing output check releases the held test amount to the owner's payable balance. Ambiguous evidence pauses release for operator review.
7. Once the owner confirms the item is removed and safe to collect, the requester redeems a single-use pickup code.
The requester can cancel before dispatch. Cancellation after payment but before dispatch initiates a refund; the job remains refund pending until the transaction is confirmed. After dispatch, an operator resolves the job; cancelling in the UI never means the hardware has stopped.

### Owner flow

1. Configure the node connection, credentials, pairing and camera in the private local setup. Open the provider workspace with the owner code; the browser does not ask for a node URL or claim to discover devices automatically.
2. In **Machines → Add a machine**, confirm the supported model and simulation/hardware mode. Registration checks the app-configured connection and capabilities. Each machine shows its actual next step, with saved pairing/configuration facts under **Connection details**.
3. Use **Settings** for loaded media, price card, hours, maximum job length, collection point and content policy. Open **Machine checks** to explicitly inspect/clear and calibrate. Physical calibration still requires supervision, a finite authorized attempt and inspection of the associated result; simulation remains labeled.
4. List the machine and resume only after the required checks. The node accepts one authorized job at a time and enforces declared capabilities and owner limits locally. **Orders** defaults to actionable work; search, filters and pages reach the rest. Production updates automatically, while order status, evidence, payment recovery, trial measurements and history remain available through native disclosures. **Payments** shows the ledger separately.
5. After each job, remove, label and store the output and clear the tray or bed. One deliberate checkbox attests all four completed actions, or **Record steps separately** retains individual progress. The app never infers those confirmations from a camera frame. Mark the stored item ready for pickup and resume availability separately; the next job does not wait for collection. Record handoff when its pickup code is redeemed. Enter media estimates by hand when the device cannot report them.
The target is under five minutes of active setup for a supported device, after installation, pairing, credentials and media are ready. Calibration and print time are reported separately. Unfamiliar models follow a separate supervised workflow.

### Output specifications


| Output | Requester approves | Preparation and verification boundary |
| --- | --- | --- |
| Thermal sticker | Actual monochrome artwork, roll and printable width (15, 25 or 53 mm), dimensions, quantity | Crop, optional background removal and dither. Describe the loaded material without claiming waterproofing or durability |
| Instax photo | Crop, orientation, the fixed Instax mini format, quantity | Prepare the JPEG the tested adapter needs; let the film develop before comparing |
| 3D object | Model preview, overall dimensions, material, single color, estimated time | Start with a known prepared model; verify visible completion without claiming dimensional or structural accuracy |

Unsupported dimensions and materials are rejected before quoting, and content is screened before checkout. Requester-created or authorized artwork is allowed under the owner's policy; unclear permission or content goes to operator review, since a blanket ban on logos would exclude a club's own artwork.

## Design doc


### Architecture

One backend application holds modules for intake, assets, registry, matching, jobs, payments, verification and fulfillment, and each owner installs one node. Every node exposes the same five tools, so orchestration stays the same across machines while each adapter keeps its own preparation and handling steps.
A requester moves from uploaded pictures to the production preview, quote, payment and explicit dispatch. Supporting settings and detailed states are disclosed when needed. The camera frame returns through the verifier, which decides whether the held test amount becomes payable, and fulfillment marks the item ready once the owner confirms preparation, then records collection after handoff.

### Components


| Component | Implementation and responsibility |
| --- | --- |
| Intake and preparation | Claude vision drafts structured intent; deterministic code validates dimensions, media, quantity and price; Pillow prepares images. Optional Cartesia speech input |
| Registry and job store | SpacetimeDB holds machines, reservations, state transitions and dashboard subscriptions, behind one store interface. Validate this path early |
| Matcher and pricer | Plain code filters by capability, readiness, policy and availability, then ranks by distance and price. The three owned machines show routing by output; wider geographic matching comes later |
| Orchestrator | Persists state changes, reserves devices, confirms payment, dispatches authorized jobs and reconciles reconnects |
| Node | Python and FastMCP around pinned adapters, an authenticated outbound connection for commands and events, a local journal of accepted and started jobs, and the uagents adapter for Agentverse |
| Payments | Mock mode first, then x402 testnet collection plus an application ledger for holds, releases and refunds |
| Verifier | A fresh result frame, a baseline where practical, and Claude vision; returns pass, fail or review with a reason |
| Fulfillment | Pickup readiness, an expiring pickup code and redemption. An optional test label stays clearly separate from shipping |
| Onboarding | Known models install pinned adapters. Stretch: Apify driver search and a Factory Droid writing an adapter for review |

SpacetimeDB subscriptions update clients, while the node connection carries commands and reconnect acknowledgments. Keeping those roles explicit leaves one source of job state.

### Job data and approvals

A job records the requester, machine, approved specification version, artifact hash, quote version and expiry, reservation, payment reference, execution attempt, evidence and fulfillment status.
```json
{
  "job_id": "j_123",
  "spec_version": 1,
  "output_type": "sticker",
  "size_mm": [50, 50],
  "quantity": 1,
  "material_id": "loaded_roll_01",
  "color_mode": "monochrome",
  "artifact_url": "https://assets.example/job/j_123/approved.png",
  "artifact_sha256": "<hash of approved artifact>",
  "machine_id": "phomemo_01",
  "quote_id": "q_123",
  "budget_cap_usd": "3.00",
  "delivery": {"mode": "pickup", "collection_point_id": "demo_table"}
}
```

The quote stores itemized integer minor-unit amounts, currency, payment mode, expiry and the approved specification hash. Changing the artifact, dimensions, material, quantity or price invalidates the matching approval. The sample budget is illustrative until measured costs replace it.
The browser combines preview approval and quoting through `POST /api/jobs/:id/approve-and-quote`. Its body captures `artifactSha256`, positive `specVersion`, the exact `recommendedMachineId` (or `null` for a legacy unbound order) and optional boolean `autoAccept`. One store mutation validates that displayed identity and commits approval, reservation and quote together. A still-current replay preserves the live quote; stale identity or unavailable capacity fails without a partial approval. The endpoint neither pays nor dispatches. Quote acceptance by `autoAccept` remains conditional on the saved explicit budget mandate.
The machine manifest lists adapter version, outputs, printable bounds, media, color modes, readiness, collection point, hours, handling requirements, price card, content policy, camera support and abort support, and reports unknown values explicitly.

### Job lifecycle and recovery

Production moves through requested → specified → approved → reserved and quoted → payment confirmed → dispatched → running → verifying → produced, failed or needs review.
Payment is tracked separately (unpaid, collection pending, held, release pending, released, refund pending, refunded), and so is fulfillment (awaiting owner handling, ready for pickup, collected). A test mailing label means only that a label was created, and verification never counts as delivery.
- A quote reserves a machine for a short configured period, two minutes to start. Payment after expiry is held for reconciliation, then rematched with approval or refunded; it never dispatches to a newly busy device.
- One atomic reservation and one active execution slot per machine prevent competing jobs.
- Repeated checkout requests share an idempotency key, and a confirmed payment reference funds exactly one job.
- Dispatch retries reuse the same execution attempt ID. The node persists acceptance before executing and returns its recorded status on retries.
- A disconnect after a possible hardware start becomes needs review. Device status and the local journal are reconciled before any new print, and we never claim exactly-once physical execution.
- Release and refund retries reconcile the existing ledger entry and transaction reference, showing pending while the outcome is uncertain.
- A failed calibration or production pauses the machine until the owner inspects and clears it.

### Node tool contract


| Tool | Input | Output |
| --- | --- | --- |
| get_capabilities | Authenticated caller context | Versioned machine manifest |
| get_status | Authenticated caller context | Readiness, device state, current job and attempt, media estimate, error |
| run_job | Signed job token, job and attempt IDs, approved artifact reference and hash, validated parameters | Accepted, rejected or already accepted, with recorded execution status |
| camera_snapshot | Authorized job or calibration context | Frame reference, capture time, device and job identifiers |
| abort | Authorized job token and attempt ID | Stop requested, stopped, unsupported or unknown |

The token binds machine, job, attempt, artifact hash, approved parameters and expiry, and the node checks all of them against its policy before acting. Artifacts must come from the allowed asset store and match the approved hash. An abort acknowledgment is not proof that the machine stopped. Read-only discovery may see a reduced public manifest; camera access, private location, execution and abort stay authorized.

### Payments and the test hold

x402 collects testnet payment for an asynchronous job submission. Once settlement is confirmed, the platform returns the job ID and dispatches; production then reports through job status, so the payment request never stays open for a whole 3D print.
Funds go to a platform-controlled test wallet, and the application ledger records a held amount per job. A passing output check makes it payable to the owner, and failed production makes it refundable to the requester, each with a recorded transaction and its pending or confirmed state.
We call this a platform-managed test payment hold. An independently enforced escrow contract is a separate stretch and is named only if it ships. x402's verification and settlement flow does not by itself define our release rules (x402 reference implementation).
Demo wallets are preconfigured, and mock and testnet modes carry visible labels, including on receipts. A mock transaction cannot count for the x402 track, and wallet setup sits outside the two-minute requester onboarding target.

### Camera verification and handling

Before a job starts, the node confirms the output area is ready and captures a baseline where useful. After the device reports completion, it captures fresh evidence and checks for a visible result consistent with the approved output, waiting for Instax film to develop first.
A pass needs both a credible completion signal and usable fresh evidence. Missing output fails, while poor framing or ambiguity goes to review; the verifier records its reason, and any operator override shows in the job history.
In this controlled demo the check can gate the test payout. It does not prove adhesion, exact dimensions or strength, or protect against a dishonest owner; a public marketplace would need its own disputes design. The owner still confirms handling before the item is ready and before the next job.

### Hardware adapters


| Device | Planned integration | First checkpoint | Fallback |
| --- | --- | --- | --- |
| Phomemo M02Pro | Bluetooth adapter on a tested phomemo_printer or CatLabel path | Print the intended sticker from the actual laptop or Pi and verify printable width | Use the tested Pi or Linux node, since macOS restricts classic Bluetooth serial |
| Instax Mini Link 3 | A tested InstaxBLE-based or compatible adapter; film costs about $0.92 a sheet | Print from code on this exact device, checking discovery, image size, orientation and completion | Time-box compatibility work; otherwise show a recording or a clearly labeled manual bridge |
| Bambu Lab A1 mini | A tested local-network adapter for prepared files, such as mcp-3d-printer-server's print_3mf | Confirm firmware settings, credentials, upload, start, progress, built-in camera view and stop | Show a recorded run and a prepared object |

InstaxBLE's supported list does not include the Link 3, and its issue tracker has Link 3 protocol and BLE-service reports (issue 21, issue 24), so an early physical test is essential. For the A1 mini, community servers report needing LAN Only and Developer Mode and a limit on concurrent MQTT clients; we test the actual unit, pick one control path and record what we observe.

### Onboarding

- Known model. The node installs a pinned adapter and runs calibration. This is the live demo for all three machines.
- Known protocol family (ESC/POS, ZPL, HPGL, OctoPrint or Moonraker, IPP). A later extension using generic adapters with probed parameters.
- Unfamiliar model (stretch). Driver search, adapter generation and software tests, then owner-supervised hardware calibration. Generated code gets only the permissions its device needs, and a calibration pass creates a review candidate that a maintainer approves and versions before other owners receive it.

### Safety

- Only supported low-risk devices are listed; lasers and CNC are excluded.
- The node enforces owner limits locally, and physical supervision stays available.
- Per-device timeouts include a startup allowance. A timeout requests a stop and operator attention, and cannot guarantee the hardware stopped.
- Photo-to-3D is limited to decorative objects at a stated size; functional parts are declined.
- The demo uses one collection point, so no owner location is shared.

## Track integrations

Fabrary keeps a broad sponsor strategy, with each sponsor's tool mapped to one step of the loop. An integration counts toward a submission only when its behavior is built and demonstrated. Prize details come from the organizers' emails and Devpost and still need the rules check under Decisions to close early.
A request runs across the top and back along the middle; the owner side underneath feeds machines in and pays owners out.

### What each track needs


| Track | Prize | Our contribution | Priority and evidence |
| --- | --- | --- | --- |
| Cal Hacks, Best Hardware Hack, Most Creative, Hacker's Choice | Bambu printer each; Instax or mouse each (Devpost) | Three physical outputs through one shared job flow | Core; record actual runs |
| Fetch.ai, Best Use of Fetch.ai | $1,500 / $1,000 / $500 (Devpost) | The authorized job workflow exposed through uAgents, Agentverse and ASI:One | P1; show discovery and a real invocation |
| Coinbase, Best Use of x402 | $4,000 across two tracks | Testnet quote, collection and receipt, with separate hold, release and refund accounting | P1; real testnet transaction references |
| Visa, Reimagining Shopping | $5,000 | Approved preview, explicit budget mandate, full quote and receipt | Core UX; confirm whether a Visa API is required |
| Microsoft, Built for the Real World and Customer Impact Award | Surface laptop per member; tech talk and FDE mentorship | A real requester or owner story and the owner dashboard | Core UX and validation |
| Spacetime, Best Use of Spacetime | $2,048 / $1,024 / $512 | Registry, state transitions and live dashboard subscriptions | Planned core store; show a machine status update reaching the UI |
| Apify, Best Use of Apify and Best Actor | $5,000 in cash prizes | Driver search for one unfamiliar model | P2; record sources found and why one was chosen |
| Factory, Best Use of the Droid SDK | Cash, credits, swag | Generate and test one adapter against the node contract | P2; code, tests and a supervised hardware result |
| Cartesia, Best Use of Cartesia | Special prize | Spoken request and spoken quote | P2; text entry keeps working without it |
| Atlassian, Agentic Challenge | AirPods Max | An owner issue opened on failure and closed after recovery | P2; one complete issue lifecycle |
| Capital One, Best Use of Nessie | Track prize | A mock payout record linked to an owner job | P2; labeled as mock |
| Anthropic, Claude for Public Benefit | $5,000 Claude credits and a year of Max 20x | Claude intake and verification serving a validated, named community | Uses core behavior; needs a concrete, consenting community example |
| Creao AI, Best AI-First Disruptor or Best One-Person Company | $3,000 / $1,500 / $500 plus an internship interview | Only a contribution that qualifies under their rules | Rules check before work |
| Figma track | $5K in Amazon gift cards | Requester and owner designs with a usable developer handoff | Rules check |
| Mana | $5,000 for the best project | Depends on required Mana usage | Rules check before work |
| Wajo (no prize) | None | Optional courier booking; packing and handoff stay with the owner | Later fulfillment extension |

We skip Convex (Spacetime fills the same role), Bright Data (Apify covers driver search), and tracks unrelated to the loop: Hyphenate, CRS Credit, Notability, Moss, Bitdeer, SpaceXAI, Meta and Armadin.

### Rules for add-ons

- Add-ons stay isolated from checkout and physical dispatch, behind feature flags.
- After the hour-20 checkpoint, run at most two add-ons at once, each with an owner, a demonstrated outcome and a two-hour stop condition.
- No second store or driver-search system unless it has a distinct required role.
- If the per-project track limit is low, enter the core tracks plus Spacetime.
- Unfinished tracks are pitched as opportunities, never as shipped. Each add-on owner writes its two Devpost sentences.
The Fetch.ai adapter guide documents FastMCP hosting and ASI:One discovery through the Chat Protocol. We prove that exact path early, since registration alone does not make every node usable.

### Public-benefit framing for Anthropic

Anthropic's judges want a named community, a real problem, a tool that works, and a team that knows where Claude could go wrong. Our candidate is Berkeley student clubs that need a small batch of custom stickers for a tabling event. We test that with two or three club officers and use only their findings and a community that agrees to be named.
Where Claude could go wrong, and our guard for each:
- It misreads size or crop, so the requester approves a preview before paying.
- It misjudges whether artwork is allowed, so unclear permission or content goes to operator review.
- It misreads a camera frame, so ambiguity becomes review and overrides stay visible.
- It writes a faulty adapter during onboarding, so generated adapters stay review candidates until a maintainer approves them.

## Feasibility and delivery plan

The requester flow and control of known devices are feasible in 36 hours. Onboarding is feasible when it means pinned adapters for known devices plus one rehearsed, supervised example for an unfamiliar model; a general agent that writes reliable drivers for any machine stays a research problem. Instax Link 3 support and live 3D control are the largest hardware risks.

### Acceptance targets before demo freeze


| Capability | Feasibility | Acceptance target |
| --- | --- | --- |
| Sticker flow | High on Linux or a Pi, medium on macOS | Ten consecutive jobs with no duplicate print or silent failure. Record upload-to-ready time and owner interventions; target a median under 60 seconds and publish the measured result |
| Instax flow | Medium until the Link 3 passes a test | Three consecutive end-to-end jobs on the actual Link 3, timing transfer, ejection, development and verification separately. Target under two minutes if measurements support it |
| 3D flow | Medium to high for a prepared file | One full recorded completion through the system and a short prepared job started live. Claim completion during judging only if rehearsal shows it fits |
| Onboarding | High for known devices | A teammate registers a supported, already connected machine in under five minutes of active setup; calibration time reported separately |
| Recovery | Medium | Rejected unpaid dispatch, repeated checkout without duplicate collection, duplicate dispatch without a second print, and a disconnect that becomes a visible review state |
| Verification | Medium | A pass, a missing-output failure and an ambiguous-image review, each with its resulting payment state |
| Payment | Medium | Testnet collection, release and refund with references; repeated callbacks create no repeated ledger actions |
| Agent discovery | Medium to high | Discovery through ASI:One and one invocation through the authorized job flow |
| Fulfillment | High | The owner confirms readiness, a pickup code works once, and collection is recorded |

These are targets, not results. Each physical loop gets a clearly identified backup recording, and a recording, manual bridge, mock payment or seeded registry entry is never presented as live automation.

### Before the event (permitted setup only)

- [ ] Confirm which pre-event setup the rules allow
- [ ] Pair the Phomemo M02Pro from the Mac and from a Pi, print the intended sticker and check printable width
- [ ] Print from code on the exact Instax Mini Link 3, checking discovery, image size, orientation and completion
- [ ] On the A1 mini, confirm firmware settings, credentials, upload, start, progress, camera view and stop with one prepared file
- [ ] Time one job per device and fix camera positions for the two Bluetooth printers
- [ ] Buy media: Instax mini twin pack ($18.49 at Target), Phomemo sticker rolls, PLA
- [ ] Set up credentials: Claude, a Coinbase developer account with a funded Base Sepolia wallet, Fetch.ai Agentverse; Meshy only for the photo-to-3D stretch
- [ ] Name owners for hardware, application flow, integrations and the pitch

### Build schedule

Hours are relative to the planned 36-hour build; confirm the actual coding window against event rules.

| Time | Main deliverable | Parallel work and exit condition |
| --- | --- | --- |
| Hours 0 to 2 | Confirm rules; prove one programmatic job per device | Smoke-test x402, Fetch.ai and SpacetimeDB; record blockers and fallback choices |
| Hours 2 to 10 | Complete sticker flow with labeled mock payment | Approved preview, node journal, state updates, result evidence, pickup readiness |
| Hours 10 to 16 | Repeatable sticker flow and Instax integration | Reservation, real pricing, dashboard, known-device onboarding; start prepared 3D integration |
| Hours 16 to 20 | x402 testnet and Fetch.ai paths through the working app | Prove release and refund logic, finish 3D control, run one complete 3D job |
| Hour 20 checkpoint | Decide the final live feature set from measured evidence | Stop adding dependencies to the physical loop; select at most two add-ons |
| Hours 20 to 26 | Finish machine paths, recovery behavior and selected add-ons | Drop unfinished add-ons at their stop condition; record full-loop backups |
| Hours 26 to 30 | Feature freeze and acceptance rehearsal | Failure demonstrations, onboarding rehearsal, Devpost evidence |
| Hours 30 to 36 | Rehearse, fix demo blockers, submit early | Pitch roles and an operator assigned; final submission verified |

If a device cannot be controlled reliably by its checkpoint, it stays in the product story with its recorded or assisted demonstration labeled. If testnet or discovery fails on venue networking, the physical loop runs in labeled fallback mode and those sponsor demos use their verified recordings. The submission states what was actually completed.

### Economics and customer evidence

For every completed trial, record consumables, machine minutes, owner handling minutes, failed attempts, API costs, quote, platform fee and owner payout, then show margin per successful order and owner earnings per active handling minute. Measured costs set the demo price card. Willingness to pay and acceptable owner workload stay open hypotheses until interviews and trial orders support them.

### Decisions to close early

1. Confirm the build window start, the per-project track limit, and sponsor requirements (a Visa API, Coinbase's two x402 tracks, Creao and Mana platform use, Fetch.ai judging notes).
2. Settle the working OS, adapter, firmware, connection and camera path for each device, starting with the Instax Link 3.
3. Confirm how testnet collection and the payment hold are implemented, and use the word escrow only for what ships.
4. Choose one real requester scenario, collection point, supported materials and a measured price card.
5. Assign workstream owners and the hour-20 fallback decisions before add-ons start.

### Pitch language

"Fabrary lets an agent turn a picture into a physical item on a nearby available machine. Today we demonstrate stickers, instant photos and a prepared 3D print on three devices we own. The platform handles the order and machine workflow; the owner loads materials, removes the output and handles collection. Supported devices onboard through tested adapters. We plan to support unfamiliar models through a supervised adapter workflow. Our demo uses test payments and checks visible output before release."
Photo-to-3D, generated adapters, mailing and add-on integrations are described by their actual status on submission day.

## Sources

- phomemo_printer (PyPI)
- CatLabel (GitHub)
- InstaxBLE supported models, issue 21, issue 24
- mcp-3d-printer-server (Playbooks)
- OctoEverywhere MCP server
- x402 reference implementation
- uAgents adapter guide (Fetch.ai)
- Meshy API changelog
- Instax mini twin pack (Target)

## Binding implementation clarifications

1. Machine availability and item collection are independent. After removing, labeling, and storing an output and clearing the machine, the owner can resume availability. A requester collecting an older order must not prevent a new job.
2. Cancellation after confirmed payment but before dispatch starts a refund. Keep refund pending visible until its transaction is confirmed. Resolve cancellation racing with dispatch atomically so only one outcome wins.
3. Mark an item ready after owner preparation; record collection after pickup-code redemption and handoff.
4. Until unfamiliar-machine onboarding is demonstrated, describe it as planned. Never imply that a stretch feature is already implemented.
