# Agento

Ask an agent anything; it looks things up for free. When there's something worth doing, it proposes one concrete move ("Buy 7 YES on Phoenix at 39¢ or less if the odds are still under 40%?"). Say yes and the move becomes a priced work order: you approve once, the agent pays for its research in USDC on Arc from a vault that only pays what you approved, re-checks the condition on fresh data, then acts. You get the result and an itemized receipt.

Three agents share one runtime; none runs a fixed recipe. Each move's steps come from the conversation.

| Agent | Domain | Explores with (free) | Paid research (x402) | Moves |
| ----- | ------ | -------------------- | -------------------- | ----- |
| **Inso** | Prediction markets | Gemini Prediction Markets search and contracts | Odds history, trade tape | Limit order on a YES/NO contract |
| **Trado** | Trading | Gemini spot prices, related markets | Spot candles | Spot limit order |
| **Travo** | Travel | Place lookup (OpenStreetMap) | Driving route | Day-by-day driving plan |

All three can search [Circle's Agent Marketplace](https://agents.circle.com/services) catalog to show what other x402 services exist and whether they accept Arc testnet.

## How it uses Arc

- **Work-order vault.** Approving a plan calls `WorkOrderFactory.open`. The factory clones a `WorkOrderVault` and funds it with the plan's USDC cap. The approved lines (index, payee, cap) are committed as a **Merkle root**, so payees and caps stay private until a line is used.
- **Proof per payment.** Each payment carries its line and a Merkle proof. The vault pays only lines in the root, only to that line's payee, only up to that line's cap.
- **x402 from the vault.** Data is sold per request over x402 (`exact` scheme, `eip155:5042002`). The agent calls `vault.authorize(line, proof, payee, amount, …)`. The vault checks the proof, the payee and the line's cap, then approves that exact EIP-3009 `transferWithAuthorization` digest. USDC verifies it through ERC-1271 (`isValidSignature`), so the money moves from the vault straight to the seller. No agent-held balance is ever spent.
- **Re-approval onchain.** When you approve a change (new price, new payee, extra step), the client wallet calls `vault.setPlan(newRoot)`, and adds funds with `topUp` if needed.
- **Circle wallets.** The agent and the data sellers are Circle developer-controlled wallets on Arc testnet; their transactions are signed through Circle.
- **Your own passkey wallet.** Users can pay from a Circle modular smart account unlocked with Face ID, Touch ID or a security key (gas sponsored by Circle's paymaster). Funding (`approve` + `open`), plan changes (`setPlan`) and top-ups are signed in the browser; the server only verifies onchain that the vault was opened by that wallet with exactly the approved plan before the agent spends.
- **Refunds.** `vault.close()` returns the unspent balance to the client and invalidates any unsettled authorization. An authorization that expires unused can be `release`d to free its cap for a retry.
- **USDC as gas.** Every fee is in USDC. Receipts show the network fee measured from each transaction receipt (`gasUsed × effectiveGasPrice`, 18 decimals).

### Contracts

| Contract | Address (Arc testnet, chain 5042002) |
| -------- | ------------------------------------ |
| USDC | `0x3600000000000000000000000000000000000000` |
| WorkOrderFactory | [`0x8e6A9725C747034231Fa0eC32845EcbCC5aa09dc`](https://explorer.testnet.arc.io/address/0x8e6A9725C747034231Fa0eC32845EcbCC5aa09dc) (verified) |
| WorkOrderVault (implementation) | [`0x19895e2092E6353D33f1fE22D571DCF38c90469e`](https://explorer.testnet.arc.io/address/0x19895e2092E6353D33f1fE22D571DCF38c90469e) (verified) |
| First version, plan stored in the clear (earlier example runs) | factory [`0x1bfB…604A`](https://explorer.testnet.arc.io/address/0x1bfBF0F370Ecd77CCD665FD677eb505c6325604A) |

Source: [`contracts/src`](contracts/src). Tests: `npm run test:contracts`.

### Example run on Arc testnet

Merkle-committed plan, agent and seller signing through Circle wallets. Inso, "How have BTC odds moved today?", approved at 0.07 USDC:

| Step | Transaction |
| ---- | ----------- |
| Vault opened and funded | [`0x9a05…78af`](https://explorer.testnet.arc.io/tx/0x9a05ce3f5783eb809ca14effdf31ab05d5faa2da8ace302248794805c15c78af) |
| Vault | [`0x3681…687a`](https://explorer.testnet.arc.io/address/0x3681E019BeF33689430908F7df27bC68aDD0687a) |
| x402 load event, 0.01 USDC | [`0x50f9…2ff5`](https://explorer.testnet.arc.io/tx/0x50f9ea1b62719d650a76bb5c3926f408868754fae3ded8ac552067162c682ff5) |
| x402 odds history, 3 × 0.02 USDC | [`0x9f11…11f7`](https://explorer.testnet.arc.io/tx/0x9f118625e3ec2737989594c06679239e2cd87938928357c6f8c691254dd311f7), [`0x9039…0a68`](https://explorer.testnet.arc.io/tx/0x9039a45a1a8de4d32e52736856f0bc409f156d497ef67a57b91261ea977d0a68), [`0x49f2…d620`](https://explorer.testnet.arc.io/tx/0x49f277586e9a585719b16af3b1f819fd23727a0ad887408188bf2d2f470fd620) |
| Vault closed, unspent returned | [`0x9044…f80`](https://explorer.testnet.arc.io/tx/0x90440a70d86e2a75a6061b254053b9cb3b210ff38aa07c111926757bf6a9cf80) |

Earlier run on the first contract version, plan stored in the clear:

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

### Arc-specific notes

- The vault moves USDC only through its ERC-20 interface (6 decimals) and never sends native value, so Arc's native-value rules (no transfers to `0x0`, no burns, `SELFDESTRUCT` moving USDC) don't apply to it. Network fees are read from receipts in 18-decimal native units.
- A payee on USDC's blocklist makes a payment revert; the run shows it as a failed step with retry / switch / cancel.
- `scripts/local-chain.sh` prefers [Arc Foundry](https://github.com/circlefin/arc-foundry)'s `arc-anvil`, because plain anvil runs a standard EVM.

## Agent decision loop

1. **Explore.** You chat. The model calls free tools (market search, spot prices, places, marketplace catalog) in a loop of up to 6 rounds and answers with the numbers it found. Nothing is spent.
2. **Propose.** When there's something to do, the model calls `propose_move`: paid research steps from a priced catalog, an optional condition (e.g. YES price ≤ 40¢), and an action. Code validates it against live data (the contract exists, the agent may do this, the order is under the limit) and prices it. A loose condition is tightened to the order's own limit.
3. **Edit.** You say yes, change it in chat, or edit a card ("5 contracts", "drop the trade tape"). The work order is re-priced.
4. **Approve.** One approval covers the whole plan, including big spends over the threshold. The vault is funded with the total plus a 20% buffer.
5. **Execute.** Research steps run in parallel. Independent steps run in parallel. For each purchase:
   1. Ask the seller for its price (HTTP 402).
   2. Check the policy against the approved line.
   3. Authorize from the vault.
   4. The seller settles onchain and returns the data.
6. **Check, then act.** An optional check on a different number (e.g. BTC spot before buying a BTC contract) is read fresh right before acting. The order then goes to Gemini as a real resting order: a **limit** order covers "buy if it drops to X", a **stop-limit** order covers "buy once it rises to X". The app tracks it (open, filled, cancelled), refreshes it, and can cancel it.
   - Every move is labelled where it goes: **Live** (real money), **Gemini sandbox** (real orders, test money) or **Simulation** (no exchange connected, nothing sent). The agent can only trade markets listed on the connected exchange.
7. **Change → ask.** If the policy blocks a spend, that step pauses and you get a re-approval popup. Other steps keep going.
8. **Fail → choose.** A failed step offers retry, skip (optional steps only), top up, or cancel. Purchases are cached per request key, so a retry never pays twice.
9. **Close.** The vault closes, unspent USDC returns to you, and you get the receipt.

### Plans across agents

Ask for several things at once ("buy 5 YES on BTC, then plan a drive from Dallas to Austin, and book a hotel") and the agent proposes one plan card: a full move per step, each for the agent that does it, plus a plain list of what it can't do here (hotel and flight booking services on Circle's marketplace take Arc mainnet only). Starting the plan runs each step as its own job, one after another, each approved within the limits shown on the card. A step can wait until the previous step's order has filled (e.g. spend what a sell brought in); if that order is cancelled, the rest of the plan doesn't run. Stop cancels the running step and returns its unspent funds. Plans pick up again after a restart.

## Safety limits

| Limit | Enforced by |
| ----- | ----------- |
| Spend only on approved lines | Policy engine (`src/lib/policy.ts`) and the vault (`NotInPlan` unless the line's Merkle proof matches the approved root) |
| Approved payee per line | Policy engine and the vault (`WrongPayee`) |
| Per-request price ≤ approved unit price | Policy engine |
| Line total ≤ approved cap | Policy engine and the vault (`OverCap`) |
| Sum of caps ≤ vault funds | Orchestrator before funding; the vault can never pay more than it holds |
| Only the agent can spend; only the client changes the plan | Vault (`NotAgent`, `NotPayer`) |
| No double payment on retry | Request-key cache, unique refs and nonces (`RefUsed`), authorization state check |
| Re-approval timeout counts as deny | Orchestrator (`REAPPROVAL_TIMEOUT_MS`, default 2 min) |
| Big spends listed and approved up front | Work order (default threshold 0.25 USDC, editable on the price card) |
| Cancel anytime, funds returned | `vault.close()` by client or agent |
| Orders only as approved | The order line (side, contract, max price, size) is part of the approved work order; the condition is re-checked on fresh data |
| Order size | Your stated budget (quantity cut to fit, shown on the card) and `MAX_ORDER_USD` (default 50); the order is paid on the exchange, never from the vault |
| Exchange terms | Gemini's prediction-market terms are shown and accepted only by your click, never by the agent |
| Model output is untrusted | Every move is validated against live data before it is shown; tool results are marked as third-party data |

The policy engine runs before any signature. The vault enforces the same rules onchain, so a bug in the app fails closed.

## Use it from your own AI (MCP)

The app is also an MCP server at `/api/mcp`, so Claude Code, Claude Desktop, Cursor or any MCP client can drive the agents. Your AI does the planning and analysis on your own subscription; the app handles pricing, the vault and payments.

| Tool | What it does |
| ---- | ------------ |
| `list_agents` | Agents, free tools, paid research prices, allowed moves, rules |
| `look_up` | Run a free tool (market search, spot price, place, marketplace catalog) |
| `ask_agent` | Chat with a built-in agent; it explores and may propose a move |
| `propose_move` | Your AI's own move, validated against live data and priced as a draft work order |
| `edit_work_order` | Change a draft by request; re-priced or refused with a reason |
| `get_job`, `list_jobs` | Status, chat, cost, steps, what it is waiting for |
| `get_job_data`, `get_receipt` | Results for your AI to analyse; itemized receipt |
| `cancel_job` | Stop and return unspent funds |

There is no approve tool. Every draft returns a link, and only the user approves spending in the app; the vault enforces it onchain. Data from markets is marked as untrusted.

```bash
claude mcp add --transport http agento http://localhost:3000/api/mcp
```

Set `MCP_TOKEN` when the app is reachable by others; clients then send `Authorization: Bearer <token>`. `node scripts/mcp-demo.mjs http://localhost:3000` plays the client side end to end.

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

To place sandbox orders, register at https://exchange.sandbox.gemini.com, create an account-scoped API key with the Trader role, and set `GEMINI_TRADING_KEY` and `GEMINI_TRADING_SECRET`. The sandbox sends no emails; at the 2FA prompt run `document.cookie = "GEMINI-SANDBOX-2FA=true; path=/"` in the browser console and enter `9999999`. New sandbox accounts get test funds. The sandbox lists crypto and commodity markets. Without keys, orders are labelled simulations. `GEMINI_TRADING_ENV=production` switches to the real exchange.

For passkey wallets, create a Circle client key bound to your domain (`localhost` locally) and set the same domain under Console → Modular Wallets → Configurator → Passkey. Put the key in `NEXT_PUBLIC_CIRCLE_CLIENT_KEY`.

### Deploy (Railway)

The app keeps a live connection per job and runs jobs in the background, so it needs an always-on server (not serverless). The repo includes a `Dockerfile` and `railway.json`.

1. New Railway project → deploy from this GitHub repo.
2. Add a volume mounted at `/data` (jobs are stored there).
3. Set variables from `.env.example`: Arc RPC and factory, the client key, Circle API key, entity secret and wallet ids, `AI_API_KEY`, `MCP_TOKEN`, and `LIVE_ACCESS_CODE` so only you can start Arc testnet jobs. The demo rail stays open to everyone.
4. Keep one replica: jobs run in the server process.

## Test

```bash
npm test               # policy, reducer and orchestrator tests, one per fault switch
npm run test:contracts # vault and factory, incl. x402 via ERC-1271 and fuzzing
npm run test:e2e       # Playwright: one browser test per fault switch, on recorded market data
npm run test:e2e:live  # same tests against the live Gemini and map APIs
npm run test:e2e:record  # refresh e2e/fixtures/market.json from the live APIs
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
