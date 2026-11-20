# Agento

AI agents that buy real data, reason over it, and only then act.

Agento has two agents. **Inso** covers everyday risks with Gemini prediction markets. **Worko** researches and verifies things before you pay or trust them: a company, a contractor, a listing. Both agents pay for each piece of data themselves, per request, in USDC on Arc. They read what came back before deciding what to buy next. Each job ends with answers backed by evidence, and for Inso, a prediction-market order or a clear reason to hold off.

## How a job works

1. **Plan.** The agent lists the questions it needs to answer and the lookups it wants to buy, with prices.
2. **Approve.** You see the most the job can cost and approve once. The budget moves to the agent on Arc.
3. **Buy and think.** Each lookup is paid with an x402 nanopayment. After each stage the agent reads the results and decides if anything else is worth buying.
4. **Answer and act.** You get the answers and a receipt of every payment. Inso places the Gemini order if the checks pass. Unspent USDC is returned.

## How it meets the requirements

### Agentic payments

The agent pays for APIs and data on its own, per request, using **x402 nanopayments through Circle Gateway**. It stays inside guardrails it can't change:

- **Budget.** You approve each job's budget once.
- **Allowlist.** A policy engine (`src/lib/policy.ts`) checks every payment before it's signed, against the approved plan: the right payee, an amount under the line's cap, no repeats.
- **No access to keys.** The AI model proposes; code validates and signs. The model never holds a key, picks a payee or raises a limit.
- **Checked deliveries.** Paid answers are checked before use, and bad sellers are paused.

**The decision loop:** understand the request → validate it against live data → you approve → lock the budget → buy → think (up to 3 rounds of follow-ups, paid from a small reserve you approved) → fixed rules judge the results → act or hold → refund what's left.

### Arc

All money moves in **USDC on Arc**, which is also the gas token, so fees and balances are in dollars.

- **Pay-in and refund.** Each job has a USDC pay-in and a refund of whatever wasn't spent, both visible on the Arc explorer.
- **Contracts.** `WorkOrderFactory` clones a `WorkOrderVault` per job. The vault commits the approved lines as a Merkle root, pays only those lines up to their caps, and authorizes x402 payments through ERC-1271.
- **Circle tools used:** Gateway (nanopayments), Developer-Controlled Wallets, Modular Wallets with passkeys and Paymaster, and CCTP / Bridge Kit for moving USDC in. Deposit and withdraw are in the app.

| Contract | Network | Address |
|---|---|---|
| WorkOrderFactory | Arc mainnet | `0xe2fC32833336e200C9003F5058D6309b0DECDdA1` |
| WorkOrderFactory | Arc testnet | `0x8e6A9725C747034231Fa0eC32845EcbCC5aa09dc` |
| USDC | Arc | `0x3600000000000000000000000000000000000000` |
| Gateway Wallet | Arc mainnet / testnet | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` / `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` |

### Gemini prediction markets

Inso works through the **Gemini Prediction Markets API** (`src/server/exchange.ts`):

1. It finds markets, places limit orders, and reads each order back to confirm it.
2. It then tracks fills and positions.
3. Orders go to Gemini's test exchange and are followed against the live order book, so you can see whether they would have filled.
4. If the bought data says the bet isn't worth it, the agent holds the order back and explains why.

## Architecture

```
Browser (Next.js)
   │
Orchestrator ── runs each job: approve → buy → think → act → close
   ├─ Planner / think step (Google Gemini model): proposes, never signs
   ├─ Policy engine: checks every payment before signing
   ├─ Payments on Arc: USDC pay-in/refund, WorkOrderVault, Circle Gateway x402
   ├─ Data sellers (x402): Chainlink via Quicknode, BlockRun, Serper, Coresignal, PredictLeads, Exa, MrScraper
   ├─ Rules + report: fixed checks judge the results; the report cites paid steps
   └─ Gemini Prediction Markets API: orders, fills, positions
```

Jobs are stored as event logs in SQLite. The browser receives them over server-sent events and rebuilds the job state with a reducer.

## Implementation

| Part | Where | What it does |
|---|---|---|
| Orchestrator | `src/server/orchestrator.ts` | Runs a job from approval to refund |
| Think step | `src/server/think.ts` | Reads results between stages and picks follow-ups |
| Tools | `src/server/tools.ts`, `web-tools.ts` | The lookups agents can buy, and validation of every proposal |
| Payments | `src/server/nanopay.ts` | x402 payments through Circle Gateway |
| Policy | `src/lib/policy.ts` | Spend rules checked before every signature |
| Exchange | `src/server/exchange.ts` | Gemini Prediction Markets API |
| Rules and report | `src/server/signals.ts`, `report.ts` | Judge the results and write the answer |
| Contracts | `contracts/src` | `WorkOrderFactory`, `WorkOrderVault` (Solidity, Foundry) |

## Setup

You need Node.js 20+ and npm. Foundry is only needed for the contracts.

```bash
git clone https://github.com/teemo9055/agento-ubc.git
cd agento-ubc
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Every variable is explained in `.env.example`.

| Group | Main variables |
|---|---|
| Arc | `ARC_RPC_URL`, `FACTORY_ADDRESS`, `CLIENT_PRIVATE_KEY`, `AGENT_PRIVATE_KEY` |
| Circle | `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, wallet IDs |
| Gemini | `GEMINI_SANDBOX_KEY`, `GEMINI_SANDBOX_SECRET` |
| AI model | `AI_API_KEY` |

Get testnet USDC at https://faucet.circle.com, then run:

```bash
npm run dev
```

The app runs at http://localhost:3000. For production, use `npm run build && npm start`. To deploy your own contracts, use `npm run deploy:testnet`.

## Tests

```bash
npm test                 # unit tests (Vitest)
npm run test:e2e         # browser tests (Playwright)
npm run test:contracts   # contract tests (Foundry)
```

## Project structure

```
contracts/     Solidity contracts and tests
src/app/       pages and API routes
src/components/  UI
src/server/    orchestrator, agents, payments, exchange
src/lib/       shared types, policy, reducer
e2e/           browser tests
scripts/       deploy and helper scripts
```
