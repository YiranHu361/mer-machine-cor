# x402 testnet MVP

Fabrary uses x402 v2 with **free test USDC on Base Sepolia (chain 84532)**.
Mainnet is rejected. No Coinbase account or CDP API key is needed for the default
public test facilitator, `https://x402.org/facilitator`.

`mock` mode only simulates payments. `testnet` mode creates an actual test-network
transaction with a receipt you can show on BaseScan. Test tokens have no real monetary value.

## First demo: one payment, no printer required

The `x402` branch is checked out in the main project folder at
`/Users/lucasjiang/Development/calhacks_26/mer-machine-cor`, including the latest
name-tag printer changes. Its payment configuration lives in the ignored `.env`.

This workspace is already configured in testnet mode. Dedicated disposable CLI
payer/recipient wallets are saved in ignored `.data/x402-test-wallets.json`;
the CLI payer still needs faucet USDC. To display only its public address:

```sh
node -e 'console.log(JSON.parse(require("fs").readFileSync(".data/x402-test-wallets.json", "utf8")).payerAddress)'
```

Browser checkout uses whichever account you connect in MetaMask and needs no
private-key export. The steps below also cover setting up a fresh checkout.

1. Install an EVM browser wallet such as [MetaMask](https://metamask.io/download).
   Create two disposable accounts: **Demo payer** and **Demo recipient**. Select or add
   Base Sepolia with these settings:

   | Setting | Value |
   | --- | --- |
   | Network | Base Sepolia |
   | RPC | `https://sepolia.base.org` |
   | Chain ID | `84532` |
   | Currency symbol | `ETH` |
   | Explorer | `https://sepolia.basescan.org` |

   The payer sends free test tokens; the recipient receives them. No Coinbase exchange
   account or API registration is required for this configuration.

   Fund the payer. Use [Circle's public faucet](https://faucet.circle.com/)
   with **USDC → Base Sepolia** to send free test USDC to its address. No faucet account is required.
2. Choose a different test wallet's public address as the recipient.
3. For the standalone command, export the **disposable payer account's** private key
   from your wallet's account details and put it in the project's ignored `.env`.
   This is an account private key (a `0x` hex string), not the wallet recovery phrase.
   Keep the payer private key local;
   use a disposable test wallet, never an account holding real assets.

   ```dotenv
   FABRARY_TREASURY_ADDRESS=0x_your_test_recipient_address
   FABRARY_TEST_PAYER_PRIVATE_KEY=0x_your_disposable_test_payer_private_key
   FABRARY_BASE_SEPOLIA_RPC=https://sepolia.base.org
   FABRARY_PUBLIC_ORIGIN=http://127.0.0.1:4318
   ```

4. In a terminal, run once:

   ```sh
   cd /Users/lucasjiang/Development/calhacks_26/mer-machine-cor
   FABRARY_RUN_LIVE_PAYMENTS=1 node --env-file=.env --import tsx integrations/test/live.ts --collection-only
   ```

This standalone SDK demo requests **0.01 test USDC**, signs with the official x402 EVM
client, calls facilitator verification and settlement, and checks the exact confirmed
USDC transfer. It prints the transaction hash and BaseScan link. It does not start a
machine, pay an owner, or issue a refund. No treasury private key is required.
The facilitator submits the collection transaction; the payer only signs an authorization.

Receipts are recorded in `/tmp/fabrary-live-payment-receipts.jsonl` (or
`FABRARY_LIVE_RECEIPTS_PATH`). If an outcome is pending or unknown, inspect that record
before running again: each explicit invocation creates a new one-cent payment.

## Use the same payment flow in “Pay & make”

Keep the public recipient, RPC and origin settings above and add:

```dotenv
FABRARY_PAYMENT_MODE=testnet
# Optional; this is already the default:
FABRARY_X402_FACILITATOR=https://x402.org/facilitator
```

Restart the app. In a browser with an injected EVM wallet, fund the browser account
with faucet USDC. Checkout asks the wallet to select **Base Sepolia**, and offers to
add the test network if it is missing. The browser flow does not use or require
`FABRARY_TEST_PAYER_PRIVATE_KEY`. Approve the preview/price and click **Pay & make**.
The quote is denominated in test USDC; simulated assignments are excluded, and entirely
simulated plans need no wallet or payment.

`POST /api/orders/:id/pay` (also `/confirm`) accepts the offer ID, plan version/digest,
artwork permission, payment/production consent and a stable idempotency key. It returns
HTTP 402 with `PAYMENT-REQUIRED`. The wallet validates the exact order, offer, plan,
amount, network, token and expiry, then retries the same body with `PAYMENT-SIGNATURE`.
The server saves the authorization reference before settlement, waits for the matching
USDC transfer and confirmations, then starts the approved jobs. The UI shows the
transaction link; confirmed responses also include `PAYMENT-RESPONSE`.

Retries and restarts reconcile the saved transaction. They do not create another
authorization or charge. If the facilitator loses its response before returning a hash,
the order stays pending for operator investigation. A payment arriving after cancellation
or expiry requires workshop review and does not start production.

This MVP focuses on collection. Existing per-job payout/refund code remains separate;
it requires a treasury signer and additional setup and is not part of this demo.

## Validation

Automated tests use the official x402 signer and cryptographic verification with offline
facilitator/RPC fixtures. They cover standard headers, mixed real/simulated plans,
duplicate requests, restart recovery, unknown settlement, and wallet consent.
They do not prove that a live testnet transaction occurred. Run the one-cent command
above with faucet-funded credentials to obtain that evidence.

## Recorded live testnet evidence (October 24, 2026)

- Standalone **0.01 test USDC** x402 collection: [confirmed transaction](https://sepolia.basescan.org/tx/0x3c9ba0582feeb5051b3c62998acd704e45e60d51cfcd71bf683893439502e879), block `49880174`.
- Chrome **Pay & make**, **0.66 test USDC**: [confirmed transaction](https://sepolia.basescan.org/tx/0x69280ee7e3cf0da0bb445a1bb6f8b5f2ac5d57aa51f6263eae5e713d15fa6690), block `49880939`.
- Both transfers were independently checked through Base Sepolia RPC for the exact
  expected USDC sender, recipient, amount, successful receipt and confirmation count.
- The browser checkout authorized and dispatched the prepared cat-sticker job after
  payment. Fabrication failed because the Phomemo could not be found over BLE.
  Payment confirmation remains visible with its transaction link.
- A prior facilitator settlement attempt returned no transaction. Its authorization
  was checked on-chain as unused after expiry before another attempt was made.

Private receipt journals are under ignored `.data/` and
`/tmp/fabrary-live-payment-receipts.jsonl`. No real-value tokens were used.

References: [Coinbase x402](https://docs.cdp.coinbase.com/x402/seller/quickstart),
[x402 SDK](https://github.com/x402-foundation/x402),
[Circle faucet](https://faucet.circle.com/).
