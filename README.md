# Agento

Bring a task. An agent turns it into a priced work order, you approve it once, and it spends USDC on Arc only on the lines you approved. You get the result and an itemized receipt.

Three agents share one core:

| Agent | Domain | Buys | Widget |
| ----- | ------ | ---- | ------ |
| **Inso** | Prediction markets | Gemini Prediction Markets data: market search, odds history, trade tape | Odds-over-time chart |
| **Trado** | Trading | Gemini spot candles plus related prediction-market odds | Price chart and trend call |
| **Travo** | Travel | Geocoding and driving routes (OpenStreetMap) | Route map and day plan |

## How it uses Arc

- **Work-order vault.** Approving a plan calls `WorkOrderFactory.open`. The factory clones a `WorkOrderVault`, funds it with the plan's USDC cap and stores one line per approved spend: payee and maximum amount. The plan hash is stored onchain.
- **x402 from the vault.** Data is sold per request over x402 (`exact` scheme, `eip155:5042002`). The agent calls `vault.authorize(line, payee, amount, …)`. The vault checks the payee and the line's cap, then approves that exact EIP-3009 `transferWithAuthorization` digest. USDC verifies it through ERC-1271 (`isValidSignature`), so the money moves from the vault straight to the seller. No agent-held balance is ever spent.
- **Re-approval onchain.** When you approve a change (new price, new payee, extra step), the client wallet calls `vault.setLine`, and adds funds with `topUp` if needed.
- **Refunds.** `vault.close()` returns the unspent balance to the client and invalidates any unsettled authorization. An authorization that expires unused can be `release`d to free its cap for a retry.
- **USDC as gas.** Every fee is in USDC. Receipts show the network fee measured from each transaction receipt (`gasUsed × effectiveGasPrice`, 18 decimals).

### Contracts

| Contract | Address (Arc testnet, chain 5042002) |
| -------- | ------------------------------------ |
| USDC | `0x3600000000000000000000000000000000000000` |
| WorkOrderFactory | [`0x1bfBF0F370Ecd77CCD665FD677eb505c6325604A`](https://explorer.testnet.arc.io/address/0x1bfBF0F370Ecd77CCD665FD677eb505c6325604A) (verified) |
| WorkOrderVault (implementation) | [`0x1C2a60C4fB2B6DB9032d7589F01FFD126D51cd0B`](https://explorer.testnet.arc.io/address/0x1C2a60C4fB2B6DB9032d7589F01FFD126D51cd0B) (verified) |

Source: [`contracts/src`](contracts/src). Tests: `npm run test:contracts`.

### Example run on Arc testnet

An Inso job, "How have BTC odds moved today?", approved at 0.37 USDC with a 0.444 cap:

| Step | Transaction |
| ---- | ----------- |
| Vault opened and funded (0.444 USDC) | [`0x61b7…79dc`](https://explorer.testnet.arc.io/tx/0x61b749370ba9a5b5f10ad00531892575c91a3c5d9bf51f2c31462ceb543d79dc) |
| Vault | [`0x7d0B…b950`](https://explorer.testnet.arc.io/address/0x7d0BC76603F5fa18B226427a270F0602f649b950) |
| x402 market search, 0.01 USDC | [`0xe121…3840`](https://explorer.testnet.arc.io/tx/0xe1218d9f1d2a3c9b8df97b720d2d3cbc6723d103d79b7cd25dd3e55e3b283840) |
| x402 odds history, 3 × 0.02 USDC | [`0xdfb5…3f3a`](https://explorer.testnet.arc.io/tx/0xdfb51063bf443880670ec306c3168b1ad6b6fae31378937464cf546658266f3a), [`0x8073…3707`](https://explorer.testnet.arc.io/tx/0x8073f2de3d277c45a3b1891b04939c2414f84b3785b006bbf7926a73a5cd3707), [`0xc7e2…f005`](https://explorer.testnet.arc.io/tx/0xc7e217b528561b93c7aa4ed5f9f2a8b1058505e1afea3bc918c7be414e78f005) |
| x402 trade tape (big spend, pre-approved), 3 × 0.10 USDC | [`0x90f2…c6cd`](https://explorer.testnet.arc.io/tx/0x90f22fc87a66c121bbf7370f171666f38ad3034a0f7b3070ed56a374f2c4c6cd), [`0x9c1d…2004`](https://explorer.testnet.arc.io/tx/0x9c1d97da4228f67b1d841c617fffaf9b79d7e7c28b2d5a1ed70c0bdae72f2004), [`0xfac7…b234`](https://explorer.testnet.arc.io/tx/0xfac777fce539d9da738d74d9afbead2d9935bf03dae96f0adab97e06bd93b234) |
| Vault closed, 0.074 USDC returned | [`0x406d…4a43`](https://explorer.testnet.arc.io/tx/0x406dc5f5b81706a7d7997902d077aab802c4487769c433b2e2d3d709cd744a43) |

Measured network fee per `authorize` call, paid by the agent: about 0.0026 USDC. The seller pays gas for settlement, acting as its own x402 facilitator.

## Agent decision loop

1. **Plan.** The agent turns the task into cards (deliverable, risk, method, price) and cost lines (step, payee, rail, unit price, max calls). The total cost is shown before anything is spent.
2. **Edit.** You change a card by prompt. The agent re-prices the plan, or says why it can't and offers edits that it can apply.
3. **Approve.** One approval covers the whole plan, including big spends over the threshold. The vault is funded with the total plus a 20% buffer.
4. **Execute.** Steps run in dependency order. Independent steps run in parallel. For each purchase:
   1. Ask the seller for its price (HTTP 402).
   2. Check the policy against the approved line.
   3. Authorize from the vault.
   4. The seller settles onchain and returns the data.
5. **Change → ask.** If the policy blocks a spend, that step pauses and you get a re-approval popup. Other steps keep going.
6. **Fail → choose.** A failed step offers retry, skip (optional steps only), switch provider, top up, or cancel. Purchases are cached per request key, so a retry never pays twice.
7. **Close.** The vault closes, unspent USDC returns to you, and you get the receipt.

## Safety limits

| Limit | Enforced by |
| ----- | ----------- |
| Spend only on approved lines | Policy engine (`src/lib/policy.ts`) and the vault (`authorize`/`pay` revert otherwise) |
| Approved payee per line | Policy engine and the vault (`WrongPayee`) |
| Per-request price ≤ approved unit price | Policy engine |
| Line total ≤ approved cap | Policy engine and the vault (`OverCap`) |
| Sum of caps ≤ vault funds | Vault (`CapsExceedFunds`) |
| Only the agent key can spend; only the client changes lines | Vault (`NotAgent`, `NotPayer`) |
| No double payment on retry | Request-key cache, unique refs and nonces (`RefUsed`), authorization state check |
| Re-approval timeout counts as deny | Orchestrator (`REAPPROVAL_TIMEOUT_MS`, default 2 min) |
| Big spends listed and approved up front | Work order (default threshold 0.25 USDC, editable on the price card) |
| Cancel anytime, funds returned | `vault.close()` by client or agent |
| Read-only domains | Agents refuse trades, bookings and other actions outside the plan |

The policy engine runs before any signature. The vault enforces the same rules onchain, so a bug in the app fails closed.

## Run it

```bash
npm install
npm run dev            # demo rail: real data, simulated settlement
```

### Local chain (live flow without a faucet)

Needs [Foundry](https://getfoundry.sh). This starts anvil with Arc's chain ID, deploys a mock USDC (EIP-3009 + ERC-1271) and the factory, and writes `.env.local`:

```bash
./scripts/local-chain.sh
npm run dev            # choose "Arc testnet" on the home page
```

### Arc testnet

1. Copy `.env.example` to `.env.local` and fill in four testnet keys.
2. Fund the wallets with testnet USDC at https://faucet.circle.com.
3. Deploy:

```bash
cd contracts && forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast
```

4. Put the factory address in `FACTORY_ADDRESS`, then run `npm run dev`.

## Test

```bash
npm test               # policy, reducer and orchestrator tests, one per fault switch
npm run test:contracts # vault and factory, incl. x402 via ERC-1271 and fuzzing
npm run test:e2e       # Playwright: one browser test per fault switch
```

Test mode on the home page injects faults:
- the seller times out, rejects the payment, fails to settle or raises its price
- the vault runs dry
- the agent tries an off-plan spend
- the analysis crashes
- a re-approval times out

Each fault shows how the app asks before anything changes.

## Stack

Next.js (App Router, TypeScript, Tailwind), React Flow, Framer Motion, Radix Dialog, viem, Foundry, OpenZeppelin. Server-sent events stream orchestrator events. The client folds them into state with a pure reducer (`src/lib/reducer.ts`) and never advances state on its own timer.

## Notes

- Jobs are held in server memory. If the server restarts mid-job, the client wallet can still call `close()` on that vault to recover funds.
- On the demo rail, settlement is simulated and labeled as such. Market data is always real.
