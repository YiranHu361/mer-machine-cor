# Shared implementation contract (v1)

Local-only application. Backend TypeScript, Express, node:sqlite isolated development mode; SpacetimeDB is required authoritative integration. Web TypeScript/React/Vite. Python node with FastMCP, Pillow, SQLite journal and authenticated HTTP tools. All dates ISO UTC; costs integer USD cents; hashes SHA256 hex.

## UI API (same origin /api)

All mutating calls JSON unless upload. API errors `{error:{code,message}}`. `POST /api/session {role:'requester'|'owner', accessCode?:string}` sets HttpOnly SameSite cookie; dev credentials configured locally, requester signup/session automatic. `GET /api/session` returns role/id. Owner login requires FABRARY_OWNER_CODE (local setup generates and prints once). UI owner form requests access code. Requesters own their jobs. `/api/health` public returns `{mode:'simulation'|'hardware',paymentMode:'mock'|'testnet',store:'sqlite-development'|'spacetimedb',integrations:{...}}`.

`GET /api/machines` => `{machines:[Machine]}` (public capabilities only).
Machine `{id,name,model,outputType:'sticker'|'instax'|'3d',adapterVersion,mode,paired,configured,calibrated,listed,ready,paused,reason,mediaRemaining,material,priceCard:{consumables,machine,handling,platform},hours:{start,end},maxJobSeconds,collectionPoint,activeJobId}`. Simulation devices explicitly labeled. `GET /api/owner/dashboard` => `{machines,jobs,ledger}` full owner scoped records.
`POST /api/owner/machines` registers supported device `{model, nodeUrl?, mode:'simulation'|'hardware'}` (hardware config blocked absent endpoint/credential).
`PATCH /api/owner/machines/:id` policy/media/pricing/hours/listed/pause/readiness. `POST .../:id/calibrate {inspected:boolean}` calls actual node calibration context, no invented hardware pass. Resume requires successful calibration and explicit cleared/inspected.

`POST /api/uploads` multipart `images` 1-4 files => `{assets:[{id,url,sha256,width,height}]}`. PNG/JPEG/WebP only, size limits.
`POST /api/jobs` `{assetIds:[string],intent:string,outputType,widthMm,heightMm,quantity,material,permission:'authorized'|'unclear',crop:'contain'|'cover',budgetMandate?:{enabled:true,capCents:number}}` => `{job}`. Missing essential specs return 422 bundled errors. Defaults UI sticker 53x50, quantity1, material thermal-paper. For Instax fixed 54x86, photo-film. 3D prepared model file from configured catalog only (not image upload converted). `PATCH /api/jobs/:id/spec` same spec invalidates approval/quote/reservation. All job responses `{job}`.
`POST /api/jobs/:id/approve {artifactSha256,specVersion}`; `POST .../quote {autoAccept?:boolean}` => `{job}`; `POST .../checkout {idempotencyKey,paymentPayload?}` mock calls external mock adapter explicitly; testnet 402 challenge/settlement. `POST .../dispatch {}` ; `POST .../cancel {}`; `GET /api/jobs/:id`; `GET /api/jobs`; `GET /api/events` SSE invalidation event, refresh jobs/dashboard.

Job fields `{id,requesterId,machineId,specVersion,spec,artifact:{id,url,sha256},approvedSpecHash,productionState,paymentState,fulfillmentState,quote?,attemptId?,evidence?,pickup?,history:[{at,event,reason}],createdAt,updatedAt,version}`.
Quote `{id,version,expiresAt,specHash,items:[{label,cents}],totalCents,ownerCents,platformCents,currency:'USD',paymentMode,collectionPoint}`.
State production specified/approved/quoted/payment_confirmed/dispatched/running/verifying/produced/failed/needs_review/cancelled. Payment unpaid/collection_pending/held/release_pending/released/refund_pending/refunded. Fulfillment unprepared/awaiting_owner/ready_for_pickup/collected.
Evidence `{url,capturedAt,machineId,jobId,result:'pass'|'fail'|'review',reason,source:'simulation'|'camera',completionCredible}`.
`POST /api/owner/jobs/:id/prepare {removed:true,labeled:true,stored:true,cleared:true}` => ready + pickup code (requester receives own code), frees machine independently of collection, explicit resume separate.
`POST /api/owner/jobs/:id/redeem {code}` atomic expiry and single use; `POST .../review {result:'pass'|'fail',reason}` audit visible; `POST .../abort {}` accurate status.
`POST /api/owner/jobs/:id/reconcile {}` reconcile existing node/payment outcome, never reprint uncertain attempt.
`POST /api/owner/jobs/:id/verify {}` takes fresh node evidence then verification. Simulation controls ONLY owner `/api/owner/simulation/:id {outcome:'pass'|'fail'|'review'|'lost_ack'}`.
`GET /api/jobs/:id/receipt` => `{job,ledger,mode}`.

## Node HTTP contract (same five tool names also FastMCP)

Node binds loopback by default, shared Bearer FABRARY_NODE_KEY required every route. Base URL env FABRARY_NODE_URL. `POST /tools/get_capabilities {machine_id}` => manifest; `/tools/get_status {machine_id}` => state; `/tools/run_job {token,job_id,attempt_id,machine_id,artifact_url,artifact_sha256,parameters,expires_at}` => `{status:'accepted'|'already_accepted'|'rejected',execution_status:'accepted'|'running'|'completed'|'uncertain'|'failed',reason?,completion_credible?,attempt_id}`. Nonblocking return; backend polls get_status with job_id/attempt_id. Signed token HMAC SHA256 compact `base64url(JSON payload).hex_signature`; payload `{machine_id,job_id,attempt_id,artifact_sha256,parameters,expires_at,scope:'dispatch'|'camera'|'abort'|'calibration'}` expiration epoch seconds. Canonical parameters exact JSON sorted keys recursively for comparisons. Node allows artifact fetch only FABRARY_ASSET_ORIGIN (`http://127.0.0.1:PORT/assets`), with signed asset query; checks SHA.
`camera_snapshot {token,machine_id,job_id,attempt_id,phase:'baseline'|'result'}` => `{frame_url,captured_at,machine_id,job_id,attempt_id,source,completion_credible,observation?:'visible'|'missing'|'ambiguous'}`. Frame URL node authenticated endpoint (backend proxies to private asset store). Sim fixtures explicit. `/tools/abort` returns `{status:'requested'|'stopped'|'unsupported'|'unknown',reason}`. Node journal durable acceptance, started-before-side-effect, startup started -> uncertain. Calibration endpoint `/calibrate {machine_id,inspected}` isolated explicitly authorized owner job and truthful hardware availability.

## External integration module ownership

integrations/ owns payment interfaces and Spacetime store. Export API is negotiated with root before use. No credentials values in tracked files. Live tests gated with explicit env report BLOCKED when missing. Fetch agent uses same backend authorization and never direct dispatch bypass. External integration docs include official references and versions.

## Final implemented contract details

- Machine hours are integer UTC start0..23/end1..24, end-exclusive, with start<end in the app. Registration reads the selected configured node and retains its separate paired/configured facts, media estimate and maximum duration.
- Prepared3D specification and signed parameters additionally bind `depthMm`, `color` and `estimatedSeconds` to the exact reviewed catalog. Sticker/Instax parameters remain the original seven keys. Prepared models are not generated from uploaded images.
- Owner calibration is `POST /api/owner/machines/:id/calibration/start {spec,ownerReady:true,idempotencyKey}`, then `GET .../calibration`. Reusing the key for changed content is rejected. Owner inspection finalizes via `/calibrate {inspected:true,attemptId,reason}`; terminal uncertainty is explicitly resolved at `.../calibration/resolve` without printing. Result-frame proxy is `GET .../calibration/evidence`.
- `POST /api/intake {assetIds,intent}` returns a Claude draft with bundled questions only; no approval, price, payment or readiness is inferred.503 leaves deterministic manual entry available.
- `POST /api/owner/jobs/:id/clear {inspected:true,cleared:true,reason}` records failed-job recovery and never clears a newer job's slot.
- Standard x402 v2 `PAYMENT-SIGNATURE` is accepted and `PAYMENT-RESPONSE` appears only for confirmed testnet collection. Deferred status returns the same durable job. No signature-only collection claim.
- `POST /api/owner/jobs/:id/payment-reference {operationId,transactionHash,reason}` accepts a candidate only after the payment adapter confirms the exact expected transfer; pending/mismatched references do not change the operation.
- `POST /api/owner/jobs/:id/economics` takes measured integer costs, machine/handling seconds and failed attempts. Quoted allocations are separate from actual confirmed payout/fees; failed/refunded orders do not count quoted income as received.
