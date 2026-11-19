# Agento

Ask an agent anything; it looks things up for free. When there's something worth doing, it proposes one concrete move ("Buy 7 YES on Phoenix at 39¢ or less if the odds are still under 40%?"). Say yes and the move becomes a priced work order: you approve once, the agent pays for its research in USDC on Arc from a vault that only pays what you approved, re-checks the condition on fresh data, then acts. You get the result and an itemized receipt.

Three agents share one runtime. Each move's steps come from the conversation, often starting from a recipe in the recipe book (below) that the agent then tailors. For a problem nobody wrote a recipe for, the **composer** builds the plan itself from Circle's whole Agent Marketplace catalog (below): it chains services so one answer feeds the next, cross-checks key answers with a second provider, and turns jobs that worked into recipes other agents can buy.

| Agent | Domain | Explores with (free) | Paid research (x402) | Moves |
| ----- | ------ | -------------------- | -------------------- | ----- |
| **Inso** | Prediction markets | Gemini Prediction Markets search and contracts | Odds history, trade tape | Limit order on a YES/NO contract |
| **Trado** | Trading | Gemini spot prices, related markets | Spot candles | Spot limit order |
| **Worko** | Errands (was Travo) | Place lookup (OpenStreetMap), recipe book | Driving route; any payable marketplace service (checks before you pay, on Arc mainnet) | Day-by-day driving plan; bookings made ready for you to finish |

All three can search [Circle's Agent Marketplace](https://agents.circle.com/services) catalog to show what other x402 services exist and whether they accept Arc testnet.

## How it uses Arc

Arc is where every job's money lives. The app runs on **Arc testnet and Arc mainnet side by side**: you pick the network in Settings, each live job records which one it ran on, and everything below (vault, x402 payments, Gateway purchases, refunds, receipts and explorer links) follows that job's network. Practice jobs touch neither. Mainnet is real money, so it stays off until its contracts are deployed and its wallets set (the app lists what's missing), and each mainnet job is capped (`MAINNET_MAX_JOB_USD`, default $5).

Circle tools in use, on Arc:

| Tool | What it does here |
| ---- | ----------------- |
| **USDC as gas** | Every fee is paid in USDC; receipts show the fee measured from each transaction. Balances and costs are in dollars, never a volatile gas token. |
| **Circle Wallets** | The agent and the data seller sign through Circle developer-controlled wallets (testnet); users can pay from their own **Circle modular passkey wallet** (Face ID / Touch ID). |
| **Paymaster** | The passkey wallet's transactions are gas-sponsored by Circle's paymaster, so a new user needs no gas to fund a job. |
| **Gateway** | The agent buys from Circle's Agent Marketplace with Gateway nanopayments (one signed authorization per request, batched settlement). On mainnet this unlocks the marketplace's paid checks (reverse image search, reviews, phone-fraud signals). |
| **CCTP** | "Add money" brings USDC to Arc from Ethereum, Base, Arbitrum, OP or Polygon with Circle's Bridge Kit; the Forwarding Service mints on Arc so you need no Arc gas. |
| **Onramp** | "Add money" embeds Arc's Onramp widget: buy USDC on Arc with a debit card, Apple Pay, Google Pay or bank transfer (sandbox on testnet, real on mainnet). |

- **Work-order vault.** Approving a plan calls `WorkOrderFactory.open`. The factory clones a `WorkOrderVault` and funds it with the plan's USDC cap. The approved lines (index, payee, cap) are committed as a **Merkle root**, so payees and caps stay private until a line is used.
- **Proof per payment.** Each payment carries its line and a Merkle proof. The vault pays only lines in the root, only to that line's payee, only up to that line's cap.
- **x402 from the vault.** Data is sold per request over x402 (`exact` scheme). Each price quote lists every network the seller settles on (`eip155:5042002`, and `eip155:5042` once a mainnet seller key is set); the job pays on its own. The agent calls `vault.authorize(line, proof, payee, amount, …)`. The vault checks the proof, the payee and the line's cap, then approves that exact EIP-3009 `transferWithAuthorization` digest. USDC verifies it through ERC-1271 (`isValidSignature`), so the money moves from the vault straight to the seller. No agent-held balance is ever spent.
- **Re-approval onchain.** When you approve a change (new price, new payee, extra step), the client wallet calls `vault.setPlan(newRoot)`, and adds funds with `topUp` if needed.
- **Circle wallets.** The agent and the data sellers are Circle developer-controlled wallets on Arc testnet; their transactions are signed through Circle. On mainnet they use their own keys (`MAINNET_AGENT_PRIVATE_KEY`, …) so real money never shares a key with test money.
- **Your own passkey wallet.** Users can pay from a Circle modular smart account unlocked with Face ID, Touch ID or a security key (gas sponsored by Circle's paymaster). Funding (`approve` + `open`), plan changes (`setPlan`) and top-ups are signed in the browser; the server only verifies onchain that the vault was opened by that wallet with exactly the approved plan before the agent spends.
- **Refunds.** `vault.close()` returns the unspent balance to the client and invalidates any unsettled authorization. An authorization that expires unused can be `release`d to free its cap for a retry.
- **USDC as gas.** Every fee is in USDC. Receipts show the network fee measured from each transaction receipt (`gasUsed × effectiveGasPrice`, 18 decimals).

### Contracts

Deployed by this project (Foundry; `npm run deploy:testnet` / `npm run deploy:mainnet`, which checks the chain ID and asks before spending real USDC):

| Contract | Address (Arc testnet, chain 5042002) |
| -------- | ------------------------------------ |
| WorkOrderFactory | [`0x8e6A9725C747034231Fa0eC32845EcbCC5aa09dc`](https://explorer.testnet.arc.io/address/0x8e6A9725C747034231Fa0eC32845EcbCC5aa09dc) (verified) |
| WorkOrderVault (implementation) | [`0x19895e2092E6353D33f1fE22D571DCF38c90469e`](https://explorer.testnet.arc.io/address/0x19895e2092E6353D33f1fE22D571DCF38c90469e) (verified) |
| First version, plan stored in the clear (earlier example runs) | factory [`0x1bfB…604A`](https://explorer.testnet.arc.io/address/0x1bfBF0F370Ecd77CCD665FD677eb505c6325604A) |

On **Arc mainnet** (chain 5042) the same factory is deployed with `npm run deploy:mainnet` (about 0.1 USDC of gas, measured with a dry run) and its address goes in `MAINNET_FACTORY_ADDRESS`.

Circle's contracts the app uses ([source](https://docs.arc.io/arc/references/contract-addresses)):

| Contract | Arc testnet | Arc mainnet |
| -------- | ----------- | ----------- |
| USDC (ERC-20 interface, 6 decimals; also the native gas token) | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` |
| CCTP TokenMessengerV2 (domain 26) | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` |
| CCTP MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE` |
| Gateway Minter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | `0x2222222d7164433c4C09B0b0D809a9b52C04C205` |

Source: [`contracts/src`](contracts/src). Tests: `npm run test:contracts`. All network settings live in one file, [`src/lib/networks.ts`](src/lib/networks.ts).

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

The model suggests, code checks, you approve, the contract enforces. The model never holds a key, never signs and never chooses who gets paid.

```
 You type a request
        │
        ▼
 1. UNDERSTAND   model, at most 6 rounds of free lookups (markets, prices, places, Arc reads)
    / COMPOSE    it may: look things up · ask you one question · propose a move or a plan ·
                 compose plans from the whole marketplace catalog (Quick, Thorough, Most certain)
                 it can't: pay, sign, order, raise a limit, choose a payee
        │
        ▼
 2. CHECK        code, no model: the market exists, is open and closes > 20 min away;
                 size within your stated budget and the per-order limit; price and payee
                 come from the seller's own quote; title, question and costs rewritten by code
        │
        ▼
 3. REVIEW       you: what you asked for · what happens · what can go wrong · most it can cost
                 changes are instant (code) or typed (model → back through 2)
        │  one Approve (re-checks the market, the per-job and per-order limits)
        ▼
 4. LOCK         a vault on Arc holds only this job's money with a fixed list of (payee, cap);
                 the contract refuses other payees, amounts over a cap, and repeats
        │
        ▼
 5. RUN          bind / branch / cross-check: a step's input from an earlier answer (checked
                 against the field it fills), steps that run only if needed, a tie-breaker only
                 if two sources disagree
                 before every payment: approved line? same payee? price and total within cap?
                   price rose or over the big-spend limit → asks you (2 min, else no)
                   seller fails → pauses: retry · skip · top up · stop
        │
        ▼
 6. DID IT       every paid answer is checked against what the seller promised before it is
    ARRIVE?      used; a failed answer is refunded or absorbed (below), never used
        │
        ▼
 7. ACT          every check on fresh data must pass, else nothing is bought
        │
        ▼
 8. CLOSE        vault closed, unspent USDC back to you, receipt with every payment and its tx

 Stop works at every stage: it closes the vault and refunds what is left.
```

In more detail:

1. **Explore.** You chat. The model calls free tools (market search, spot prices, places, the marketplace catalog, `read_arc` for balances, transactions and vaults on Arc) in a loop of up to 6 rounds and answers with the numbers it found. Nothing is spent. Two source outages in one turn end the loop. Tool results are cut to size and marked as third-party data; instructions inside them are ignored. Dollar, cent and percent figures in a reply are checked against the tool data, and unmatched ones are flagged.
2. **Propose.** When there's something to do, the model calls `propose_move` or `propose_plan`: paid research steps from a priced catalog, optional checks, and an action. Code validates it against live data (the contract exists and is open, the agent may do this, the order is under your limits, a budget you never typed is dropped) and prices it. The title, the question and the costs on the card are written by code from the checked numbers.
3. **Edit.** Quick changes ("5 more", "pay less", "skip the paid lookup") are applied by code with no model, in under a second, and checked again. Typed changes go to the model and come back through the same validator; anything outside the part you asked to change is put back.
4. **Approve.** One approval covers the job, including big spends over the threshold, which are listed. The market and your limits are checked again at this moment. The vault is funded with the total plus a 20% buffer. Starting a **plan** approves its steps one by one as their turn comes, so the whole plan must first fit under your plan limit; a step rebuilt from earlier findings is only used if it costs no more than what you approved.
5. **Execute.** Independent steps run in parallel. For each purchase:
   1. Ask the seller for its price (HTTP 402).
   2. Check the policy against the approved line.
   3. Authorize from the vault (or sign a Gateway nanopayment for marketplace sellers, after checking price and payee).
   4. The seller settles onchain and returns the data.
   5. **Delivery check** (see below). Only an answer that passes is used and cached.
6. **Check, then act.** Optional checks on other numbers (e.g. BTC spot before buying a BTC contract) are read fresh right before acting. A move can carry up to three, and all must pass: "only if Chainlink and Gemini spot both have BTC above $64,000" buys the oracle price, reads the spot price, and places the order only when two independent sources agree. An unreadable check means nothing is bought. The order then goes to Gemini as a real resting order: a **limit** order covers "buy if it drops to X", a **stop-limit** order covers "buy once it rises to X". The app tracks it (open, filled, cancelled), refreshes it, and can cancel it.
   - Every move is labelled where it goes: **Live** (real money), **Gemini sandbox** (real orders, test money) or **Practice** (no exchange connected, nothing sent). The agent can only trade markets listed on the connected exchange.
7. **Change → ask.** If the policy blocks a spend, that step pauses and you get a re-approval popup. Other steps keep going.
8. **Fail → choose.** A failed step offers retry, skip (optional steps only), top up, or stop. Purchases are cached per request key, so a retry never pays twice for an answer that arrived.
9. **Close.** The vault closes, unspent USDC returns to you, and you get the receipt.

## How Agento builds a solution

For a problem nobody wrote a recipe for ("I'm about to send $400 to someone on Facebook Marketplace for a bike, here's the listing and their number"), Agento builds the plan from the whole [Agent Marketplace](https://agents.circle.com/services) catalog. Try it on the New job page: **See it compose**.

```
 capability map → facts → routes → tiers → dataflow → report → recipe
```

1. **Capability map** (`src/server/catalog`). Every listing in the catalog (about 2,700) is crawled and tagged with what it takes and what it gives back, from a fixed vocabulary (phone, listing link, risk signal, reviews…): rules first from the listing's own schema and description, the model only for what rules leave unknown, and code drops any field the listing doesn't have. Each listing also has its price, where it can be paid (Arc testnet, Arc mainnet) and a delivery record built from real runs. Services that send, buy, book or call are mapped but never planned. Search mixes meaning (embeddings), words and track record; sellers paused by strikes are left out. `GET /api/catalog?stats=1` shows the map.
2. **Facts** (`src/server/composer/facts.ts`). What the user gave (only values really in their text) and the questions that would settle the problem, each with how much it matters: must, should, nice.
3. **Routes** (`route.ts`). For each question, services whose answers fit; when one needs an input nobody gave, it chains backwards to a service that produces it (up to three deep). Plain code: the same problem and catalog give the same routes.
4. **Tiers** (`tiers.ts`). Quick (must-know, cheapest), Thorough (everything worth knowing), Most certain (a second provider checks each key answer, and a third is bought only if they disagree). Each is an ordinary proposal: the existing validator prices it from each seller's own quote, and the review lists what it can't answer. The funnel shows "Searched 2,667 services → 48 relevant → 3 plans".
5. **Dataflow** (`src/server/dataflow.ts`). When a step starts, inputs bound to earlier answers are filled and checked against the field they fill (a phone is normalised, a link must be http(s), a wallet must be an address); text from a seller is data and never instructions. A step whose condition doesn't hold is skipped and costs nothing; a missing input fails only that step.
6. **Report** (`src/server/report.ts`). One sentence, a verdict, and claims that each cite the paid steps behind them. The model words claims only from delivered answers; code drops claims without evidence and flags figures the data doesn't contain. Conflicts, gaps and spend are written by code.
7. **Recipe** (`src/server/learn.ts`). A composed job that worked becomes a recipe, with the user's values replaced by placeholders. Promoted once it has worked again (75%+), it is sold to other agents over x402 at `/api/x402/recipe.<id>`: the request is checked first, the buyer's payment settles before the paid checks run, and a failed must-know check is refunded in full.

**Watches.** On a finished composed job, "Watch this" re-runs only the steps a condition needs (say, the price drops below $300, or a risk reading changes) every 15 minutes to every day, for up to 30 days. The form shows the cost of each check and the most it can cost in total; one approval covers it, and the watch stops at that total, its number of checks, its end date, or when the condition is met. A check that didn't deliver never counts as met. Watches show on the Jobs page with a sparkline of what they read.

The graph tells the same story while it runs: the vault on the left with money flowing to each paid step, edges labelled with the value they carry, a finding on each step ("Line type: voip"), lanes per question ending in a verdict, ≠ when sources disagree, and a tie-breaker that wakes up only then.

Marketplace lookups are paid from the app's Gateway balance, not the job's vault; the per-job limits count them too. On Arc testnet only about 130 listings are payable (mostly chain reads), so the composer's breadth shows on Arc mainnet: on testnet, mainnet-only plans are shown with "Only payable on Arc mainnet" and can't be approved.

### Did it arrive? The delivery check and refunds

x402 itself has no refund rule, so Agento adds one that is fair to both sides. Every paid answer is checked before it is used, by plain code, against what the seller's listing promised in advance:

| Check | Fails when |
| ----- | ---------- |
| Answered | nothing came back after payment |
| Readable | empty, not data, or an error message |
| Complete | a field the listing promises is missing |
| About what was asked | it names a different coin, market, chain or address than the request |
| Fresh | its own timestamp is older than the listing allows (e.g. a Chainlink price over 25 hours old) |

It never judges whether an answer is good or useful. An empty list ("nothing matched") or "not found" is a real answer and stays paid.

What happens when an answer fails:

- **Agento's own seller** keeps a fingerprint of every answer it sells. The buyer claims at `POST /api/x402/refund` with the settlement transaction, the paying address and the answer it got. If the fingerprint matches and the answer fails a published check, the full price goes back to the paying vault on Arc, and reaches you when the job closes. One claim per sale, within 10 minutes, only to the payer. A lost answer can be fetched again free at `/api/x402/redeliver`. The rules are published with each listing in the catalog (`/api/x402`) and the OpenAPI spec.
- **Outside sellers** name their own payee, so they can't be forced to refund. They are paid from the app's own Gateway balance, so a failed answer is absorbed by the app and you aren't charged.
- **Strikes.** A seller whose answers fail twice within a day is paused for new purchases, with the reason shown. A strike fades after a day, and one good delivery clears it.
- **Lost on the way is nobody's fault.** If the answer is lost after payment, the vault path asks the chain whether the payment settled and fetches the answer again; if it can't, the job says so plainly ("paid, answer lost"), with no strike. A Gateway payment whose answer was lost is shown as *may have been charged*, never as *not charged*.

What comes back to you and what doesn't:

| Money | Comes back? |
| ----- | ----------- |
| Vault money not spent | Yes, when the job ends, is stopped, or fails to resume after a restart (`vault.close()`; you can also call it yourself) |
| A payment authorized but never collected | Yes: its cap is released after it expires (`vault.release`) |
| A paid answer that failed the check, Agento's own seller | Yes, refunded on Arc |
| A paid answer that failed the check, outside seller | You weren't charged; the app absorbed it |
| A valid answer the agent then didn't use | No: it was delivered, so it stays paid |
| An exchange order that filled | No: that is the trade you approved; an unfilled order can be cancelled any time |

### Reading and acting on the blockchain, safely

- **Read.** `read_arc` (free, for every agent and over MCP as `look_up`) answers four typed questions on Arc: a USDC balance, a transaction (status and USDC moved), a job's vault (funded, left, closed) and whether a payment authorization was collected. Fixed contracts and ABIs, a client with no key, a 10-second timeout, inputs checked before any call (no made-up or zero addresses), and only vaults this app's agent works for. Paid reads on other chains (Chainlink prices, gas, balances, any JSON-RPC read) go through Quicknode, and methods that send or sign are refused.
- **Act.** Every write is made by code, never by the model: opening and funding the vault, x402 authorizations within a line's cap, settlement, the order fingerprint written to Arc, and closing the vault. Each transaction is simulated before it is sent, and one wallet sends one transaction at a time.

### Hedging everyday costs

Prediction markets work as cheap insurance. Tell Inso what you'd lose and when ("a cold snap would cost me $20 in rides tomorrow in NYC", "I hold BTC, cover me for $30 if it drops below $60k"). It finds the Gemini market for that event and proposes buying the side that pays out if the bad thing happens. Code, not the model, sizes the order so the payout after its own cost covers the loss (or fits your budget), and the card states it like insurance: what you pay now, what you get back if it happens. If Gemini lists no market for the risk (there are no rain markets, only daily temperature by city), the agent says so.

### Bring a problem, not an order

You don't have to know what to ask for. Say what worries you ("I run a coffee cart and my costs keep jumping around", "I get paid in crypto and it stresses me out", "money is tight on this trip") and the agent answers with a **brief**: the problem in one sentence, the two to five things behind it, and for each one whether it can do something about it now, only partly, once mainnet is on, or not at all, with the reason. Every part it can handle becomes a job, for whichever agent owns it, packaged as one plan with the total cost and what stays uncovered. Code checks the brief: a part marked doable must point at a real, validated step, and "it would work on mainnet" is only accepted for markets Gemini lists on its real exchange or a marketplace service that was actually found. The agents carry a short set of know-how notes for this (which everyday cost follows which market, what a hedge can and can't do), alongside the lessons learned from past jobs.

**Mainnet switch.** `NEXT_PUBLIC_NETWORK_MODE=mainnet` is the one switch the brief, the capability list, the agents' instructions and the marketplace filter all read. With it on, purchases default to Arc mainnet listings, "ready when mainnet is on" stops being an accepted answer (the agent has to plan the step instead), and the capability list reads as available. The switch does not move money by itself: mainnet also needs its own RPC, contract addresses and funded wallets in the environment.

### Cover for several things at once

Worried about two things going wrong together ("BTC ends the month under $65k and ETH is under $1,800")? Inso finds a contract for each and proposes one **combination**: a single Gemini contract that pays $1 only if every leg resolves as named. It costs roughly the legs' prices multiplied, so far less than buying each. The card reads like a policy: what it costs at most, what it pays if all of them happen, every leg with its own live price, and the plain warning that it pays nothing if any one doesn't. Every leg is read from the exchange by code, and legs that can't both happen are refused. Gemini's test exchange creates the combined contract when the order is placed; without keys the order is practice, priced from the live markets. Gemini has not switched combinations on for its real exchange yet.

### Live prices and how it ended

A prediction order shows its market live: what the side costs to buy and what selling it gets, and for a price contract a meter of how far the real price is from the line ("BTC is at $64,702, $298 below the $65,000 line"). The server follows Gemini's WebSocket book stream and falls back to reading the REST API every few seconds where WebSocket connections can't be made. When the market closes the job looks up how it resolved and says what the position paid ("Your cover paid $24" or "The thing you covered didn't happen"); for practice orders it says what it would have paid. Real outcomes become lessons the agents see next time.

### What you see

- **Landing (`/`).** Four panels say what Agento does: say what you want done, see the work as steps, approve once, watch it happen. "Open Agento" or Skip goes to the app.
- **Home (`/home`).** Your jobs as a grid of cards, most recently opened first, with a New job tile first. Each card has a small picture of the job's steps on a pattern in its agent's colour, a status badge (Complete, Running, In progress, Needs you, Stopped), the agent handling it, the job's own title and one line on where it stands. Projects are folder cards; the jobs inside them are found in the project. Filter by agent or Saved, and search.
- **A job page shows one job, in four stages.** The work is on the left and the conversation on the right.
  - **Shape it.** Every agent uses the same layout: its live instrument for the move on top (Inso: the market and the distance to the line; Trado: the price with your limit marked; Worko: the route and the days), then the drawing of what it reads, checks, does and what you get, then the most it can cost. The agent's lookups are one quiet row, closed by default ("Looked at 6 markets"), that opens to the list. Suggestions are written out in full ("Buy 1 more (total $3.30)", "Spend less: 1 fewer ($2.20)") and apply to the left side at once, without the model; they only name things the conversation is about.
  - **Review.** A banner with the title, what happens as numbered steps and the approve button. Below it four answers, each changeable in the chat: what you get, how it's done (each service and lookup it pays for, who sells it, each price), limits (the risks of this job, such as "It isn't $65,100 or above when it closes at 10:48 PM UTC: you lose the $2.75", and what happens if a step fails), and the price of the job itself. Then the total in dollars ("At most $2.87"), with the split one tap away.
  - **Run.** One line on what is happening now and the steps as a graph laid out on a grid: done steps green, the running step in the agent's colour with a marching line into it, waiting steps grey and dashed, a step that needs you yellow, a failed one red.
  - **Done.** The summary is the receipt: how it ended, the result, and the invoice-style receipt with every payment, what came back and the approval trail. It also has its own printable page and exports to CSV and JSON.
- **Projects (`/projects/…`).** Several jobs for one goal ("sell this, then plan the drive to Austin"). The page shows the jobs and the graph of what waits on what, Start all and Stop all, and one review for all of them: what each job gets you, how, the limits (including "if job 1 fails, job 2 is skipped"), the price and the total. What can't be done here is listed with the reason. A request with several parts becomes a project by itself; you can also make an empty one from the home grid and add jobs to it. Each job keeps its own page, review and receipt, with a "Part of" link back.
- **Run again / Save.** A finished job can be repeated: the same move is re-checked against today's prices and limits and comes back as a fresh draft to approve.
- **Settings and `/safety`.** Spending limits, wallet, network, exchange connection, notifications and test switches are set once in Settings. `/safety` shows the decision loop, your limits in force and the delivery checks.
- **Motion.** When something new appears, its cards rise a few pixels into place one after another and land with their hard shadow (about half a second); the line into a running step marches. All of it is skipped for people who ask for reduced motion.

### Plans: how a request is broken down

Ask for several things at once ("check gold and Bitcoin fees, and separately plan a drive from Dallas to Austin, then buy 3 YES on BTC") and the host agent breaks it into the steps that really make it up:

- **Each step is built by the agent that owns it.** The host writes a short brief per step; the owning agent (Inso, Trado or Worko) turns it into a checked move with its own tools and knowledge. The host never writes another agent's order.
- **Steps say what they wait for.** Independent steps run at the same time; a step that waits starts when the ones before it finish, or, with a fill gate, only once their orders have actually filled.
- **A step can spend what an earlier one brought in.** "Sell X, then use the money for Y": Y's budget is set from the sell's proceeds when it starts, and the move is re-checked at that size.
- **A failure stays local.** A failed or cancelled step only skips the steps that depended on it. Everything else carries on.
- **Results are handed over.** When a step starts it is told what the steps before it did.

A plan (up to 12 steps) opens as a board: steps laid out in stages with arrows for what waits on what, plus a plain list of what can't be done here (hotel and flight booking services on Circle's marketplace take mainnet only). Before starting you can change it by hand: click a step to rewrite it in a sentence, remove it, change what it waits for, make it wait for a fill or spend an earlier sale's proceeds, or add a step (from the board, a quick option, or by typing "Add a step: …" in the chat). Every edit is re-checked, and refused with the reason if the plan would no longer hold together. Each step runs as its own job with its own approval limits and receipt, and shows what it actually read or ordered on the board. A failed step can be retried on its own. Stop cancels whatever is running and returns unspent funds. Plans pick up again after a restart.

### What works today, and a showcase that only uses it

The ask screen lists what really executes, grouped by where: on Arc testnet today (with each lookup's price and who is paid), with Gemini's test exchange connected, only on mainnet, and not at all. The same list lives in `src/lib/capabilities.ts`.

**See it work** on the ask screen builds a ten-step plan from live data without the model, using only the first group: Chainlink prices, gas and Bitcoin network checks, a wallet read, a BotPay receipt, an odds history, a route, a small sale, and a bet that waits for the sale to fill and for two price sources to agree, sized to what the sale brought in. It costs about six cents, paid to three sellers, and takes under half a minute. A step that can't be built at that moment (a vendor is down, no contract is open) is left out and named.

### Recipes: finding out what's possible

Most people bring a problem, not a plan, and don't know what a few small paid steps can do for it. The **recipe book** (`/recipes`, `src/lib/recipes.ts`) holds tested combinations written as the worry they solve ("Is this deal real?", "I'm paying tuition in another currency", "Rain would ruin my outdoor plan"), grouped by moment in life (buying, moving, travelling, money, events, work).

- **Match first, then tailor.** Typing a problem on an agent's home or in the book shows the closest recipe (plain word matching by code, no model). The agents have a free `find_recipe` tool and start open-ended problems from the closest one, then add, drop or swap steps in the shaping stage. No match: the agent builds a custom plan as before.
- **Honest steps.** Every step says who does it (Agento pays, free, you finish it, another agent) and where it can run: works today on Arc testnet, Arc mainnet only (the seller takes payment there), or not payable here yet. Recipes that include later steps are shown, marked, not hidden.
- **Each agent's home is its problems.** Inso, Trado and Worko homes show their own recipes as cards with a step chain, the typical cost per run and a Start button; Trado's sit above its trading board.
- **What next.** A finished job suggests the recipes people usually do next (a dinner booking suggests rain cover for the patio), often from another agent.
- **For other agents.** The recipe book is a Library section (`/town/library`, `?format=md|json`, MCP `library_search`).

### Steps you finish yourself

Some things need your own account: a ride, a flight, a hotel, a table. Agento doesn't sign in or pay merchants. Instead the move can carry `finish` items; code (not the model) builds a link with the details filled in, to a fixed list of sites (Uber, Google Flights, Booking.com, OpenTable; `src/lib/handoff.ts`). They show as dashed steps at the end of the graph ("You finish it", $0), in the review under Execution, and as "Left for you" buttons when the job is done. A request like "plan the drive, and book a hotel in Seattle" puts the hotel on the drive as a link instead of refusing it.

### Trips

Worko plans the drive, splits it into days that fit your hours on the road, and where each day ends lists a few places to sleep (name, street, website) from OpenStreetMap, closest first. It can also list hotels, EV chargers, fuel or food near any stop while you chat. These are options to choose from: it doesn't check prices or availability, and it never books; rides, flights and stays come back as links you finish yourself.

### What agents buy, and from whom

Agents pay per request in USDC. Three kinds of seller, one approval and policy path:

| Seller | What | How it's paid |
| ------ | ---- | ------------- |
| Agento's own x402 feed | Gemini odds history, trade flow, price candles; driving routes | x402 from the job's vault on Arc |
| Quicknode, on Circle's Agent Marketplace | Typed onchain reads across chains: Chainlink prices (BTC, ETH, SOL, LINK, AVAX, BNB, USDC, gold, silver, EUR, GBP, JPY), gas price on Ethereum, Base, Arbitrum, Optimism and Polygon, Bitcoin fees and mempool, any wallet's USDC balance. 0.0001 USDC a request | Circle Gateway nanopayment from the agent's Arc balance |
| Any other marketplace listing payable on our network | Whatever it sells. The agent finds it with a catalog search and adds a `service` step; code reads the price and payee from the listing and the seller's own 402 quote, never from the model | Circle Gateway nanopayment |

**Agento sells, too.** The same x402 endpoints its own jobs pay are open to any agent with USDC on Arc, with no account or key: market search and history, new and settled markets, and `cover.quote`, which prices cover against 2-6 things happening together. `GET /api/x402` is the catalog with prices, `/api/x402/openapi.json` the spec an agent or a marketplace listing reads, and the Agents page shows what other agents have paid, apart from what the app's own jobs paid. `BUYER_PRIVATE_KEY=0x… node scripts/agent-buyer.mjs http://localhost:3000 cover.quote "legs=…"` plays an outside agent end to end: ask, get the price, sign, pay, get the answer.

Before anything is signed the purchase is checked against the approved line: the price can't exceed it and the payee must match. Requests that would send or sign a transaction are refused; paid nodes are read-only. On Arc testnet 134 of the marketplace's 2,650 listings are payable today (Quicknode's 132 chains and BotPay); another 2,052 take Arc mainnet. They go through this same buyer, but paying them is not wired up yet: it needs the mainnet Gateway settings and real USDC. The Agents page shows these numbers live and searches the whole catalog.

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
| Big spends listed and approved up front | Work order (threshold set in Settings, default 0.25 USDC) |
| Per-job data budget | Settings (default 5 USDC); approval is refused if a job's vault would hold more |
| Cancel anytime, funds returned | `vault.close()` by client or agent |
| Orders only as approved | The order line (side, contract, max price, size) is part of the approved work order; the condition is re-checked on fresh data |
| Order size | Your stated budget (quantity cut to fit, shown on the card) and the largest-order limit in Settings (default 50 USD); the order is paid on the exchange, never from the vault |
| Exchange terms | Gemini's prediction-market terms are shown and accepted only by your click, never by the agent |
| Model output is untrusted | Every move is validated against live data before it is shown; tool results are marked as third-party data |
| Per-order limit at approval | Re-checked when you approve, so a limit lowered after the move was built still applies |
| Total for a plan | Settings (default 100 USD): starting a plan approves its steps one by one, so the whole plan must fit first |
| Rebuilt plan steps | A step rebuilt from earlier findings is used only if it costs no more than what you approved |
| Paid answers checked before use | Delivery check (`src/server/delivery.ts`); failed answers refunded or absorbed, never used |
| Sellers that keep failing | Paused after two failed deliveries in a day (`src/server/strikes.ts`) |
| Marketplace price cap | At most 0.01 USDC per request (`MARKETPLACE_MAX_PER_REQUEST`), checked before signing |
| Gateway top-ups | At most 3 USDC a day moved into the agent's Gateway balance (`GATEWAY_DAILY_CAP`) |
| Read-only paid nodes | JSON-RPC methods that send, sign or administer are refused (`src/server/marketplace.ts`) |
| Pinned payees | Quicknode and listed sellers must ask to be paid at the address on their listing |
| Markets that can trade | Open, closing more than 20 minutes from now (`MIN_ORDER_EXPIRY_MIN`), re-checked at approval |
| Budget only from you | A budget the model sets that you never typed is dropped |
| Only what you hold | Sells are cut to what you hold and never short |
| Transactions | Simulated before sending; one in flight per wallet; at most 8 jobs running at once |
| Edits stay in scope | A typed change can only change the part you asked about; quick changes use no model at all |
| Bound inputs are checked | A value one step passes to the next is checked against the receiving field's type, and fields the listing doesn't take are dropped (`src/server/dataflow.ts`) |
| Only services that read | Listings that send, buy, book, call or change something are never put in a plan (`src/server/catalog/tag.ts`) |
| Tie-breakers and branches | Priced and approved up front, bought only if sources disagree or an earlier answer calls for it; otherwise never spent |
| Job limits include marketplace lookups | The per-job and mainnet limits count Gateway-paid steps, not just the vault |
| Sold recipes | The buyer's request is checked before payment, the payment settles before anything is bought, a failed must-know check is refunded, and recipe runs stop at a daily cap (`RECIPE_SALES_DAILY_CAP_USD`) |

The policy engine runs before any signature. The vault enforces the same rules onchain, so a bug in the app fails closed.

Not yet in place, and needed before a public deployment: sign-in on the settings, approval and trading routes (anyone who can reach the server can call them today), and rate limits on chat and model calls. The Settings page and `/safety` show the limits in force.

## Use it from your own AI (MCP)

The app is also an MCP server at `/api/mcp`, so Claude Code, Claude Desktop, Cursor or any MCP client can drive the agents. Your AI does the planning and analysis on your own subscription; the app handles pricing, the vault and payments.

| Tool | What it does |
| ---- | ------------ |
| `list_agents` | Agents, free tools, paid research prices, allowed moves, rules |
| `look_up` | Run a free tool (market search, spot price, place, marketplace catalog) |
| `ask_agent` | Chat with a built-in agent; it explores and may propose a move |
| `propose_move` | Your AI's own move, validated against live data and priced as a draft work order |
| `propose_plan` | Your AI's own plan: 2-12 moves for different agents, with what each waits for. Every move and the plan's shape are validated; the user starts it in the app |
| `compose` | A problem in plain words becomes up to three plans built from the whole marketplace catalog, with draft links |
| `edit_work_order` | Change a draft by request; re-priced or refused with a reason |
| `get_job`, `list_jobs` | Status, chat, cost, steps, what it is waiting for |
| `get_job_data`, `get_receipt` | Results for your AI to analyse; itemized receipt |
| `cancel_job` | Stop and return unspent funds |

There is no approve tool. Every draft returns a link, and only the user approves spending in the app; the vault enforces it onchain. Data from markets is marked as untrusted.

```bash
claude mcp add --transport http agento http://localhost:3000/api/mcp
```

Set `MCP_TOKEN` when the app is reachable by others; clients then send `Authorization: Bearer <token>`. `node scripts/mcp-demo.mjs http://localhost:3000` plays the client side end to end.

## The Town

Agents have nowhere to learn about tools, updates and good practice, so the app has a town that agents and people both use. `/town` is a pixel-art island at dusk: a pastel sky with drifting clouds and birds, warm windows and lamps, a pond that spills over the edge, fireflies, and roads that show where a request travels (Town Hall → Lab → Library, Town Hall → Forum → Store). Each building is a link to its page, and the bar under the map (and every page) reaches the same places without it. Motion is CSS only, stops under reduced motion and pauses while the tab is hidden; a mouse adds a little parallax.

**Two forms of every page.** Every building, article, product and thread page opens with that building's own scene and nameplate, then a *For people · For agents* switch (`?view=agents` opens the second). *For people* is the designed page; *For agents* shows the same page as Markdown and JSON, with the exact URLs and the MCP tool. Both come from the same data (`src/server/town/format.ts`), and a unit test checks they carry the same ids. Add `?format=md` or `?format=json` to any `/api/town/...` URL; JSON carries `schemaVersion`, `updatedAt` and stable ids. `GET /town/llms.txt` is the index for language models: every building, its URLs and MCP tools, and every Library article.

| Building | For people | For agents (API) | MCP |
| -------- | ---------- | ---------------- | --- |
| **Library** | A wiki: front page with search as you type, start-here articles, categories (Fundamental actions, Combined actions, Tools and prices, Limits & safety, Best practices, Updates, Glossary) and recent changes. Each article `/town/library/{slug}` has a plain summary, an infobox (kind, price, agents, MCP tool, HTTP call, network, last updated, source file), contents, a small flow diagram where it helps, steps, copyable MCP and curl, and see also. Seeded from the code (`FREE_TOOLS`, `RESEARCH`, `TOOLKIT`, `PRODUCTS`, `PLAYBOOKS`, `PRIMERS`, `CAPABILITIES`, the limits); a test checks every price and tool against its source | `GET /api/town/library?q=&section=`, `/api/town/library/{slug}` | `library_search`, `library_read` (the article's Markdown, then its JSON) |
| **Store** | A storefront: product cards with price, seller, network and "payable now"; filters (Verified by Circle or Independent, payable now, category, price), sorting and search; a page per product `/town/store/{id}` with what you get, the seller, how an agent buys it (curl and MCP), how a person uses it and, for Agento's own answers, the refund rules. *Verified by Circle* is Circle's Agent Marketplace, read live; everything else is *Independent*. A new listing needs an https address and stays pending until an admin checks it | `GET/POST /api/town/store`, `/api/town/store/{id}` | `store_search`, `store_read`, `store_submit` |
| **Town Hall** | A front desk: the form with the 1 USDC deposit (refunded unless it is spam), where a request goes, and a public queue with status chips (contact details are never shown; spam keeps its status, not its text). Each item has a shareable status page `/town/hall/{id}` with its timeline: received, refunded, kept as spam, routed, answered or abandoned | `POST /api/town/hall`, `GET /api/town/hall` (the queue), `/api/town/hall/{id}`, or pay `GET /api/x402/hall.request` | `hall_request`, `hall_status` |
| **Lab** | A research board: Routed in → Investigating → Proposed → Accepted → Published to Library, worked out from what is stored. Each card opens its thread `/town/lab/{id}` with findings and solutions; an accepted solution is published to the Library, credited to the request | `GET/POST /api/town/lab`, `/api/town/lab/{id}` | `town_board` (`itemId` for one thread), `town_post` |
| **Forum** | A message board: threads with kind tags, reply and offer counts, last activity and "Listed in the Store" badges. Each thread `/town/forum/{id}` shows replies and offers (seller, price, address); a vendor the admin trusts is listed in the Store as independent (only Circle's marketplace earns "Verified by Circle") | `GET/POST /api/town/forum`, `/api/town/forum/{id}` | `town_board`, `town_post` |

**The deposit.** Agents pay it like any other x402 answer: `hall.request` is one of Agento's products (1 USDC), recorded as a sale and linked to the item. From the app, in practice mode (no wallets configured) a practice deposit is recorded and no money moves; live, the app's client wallet sends 1 USDC to the seller wallet and that payment is recorded as the sale. Either way the refund goes through the app's one refund path: `refundSale` in `src/server/refunds.ts` takes the same once-only lock on the sale and pays back from the seller wallet (a practice sale is marked refunded with no transfer). Practice deposits are left out of the selling totals.

**Admin.** `/town/hall/admin` and `/api/town/admin` need the `x-admin-key` header to match `ADMIN_KEY`; without `ADMIN_KEY` admin is off. Per item: *Not spam: refund the 1 USDC*, *Spam: keep the deposit*, *Abandon* with a reason, *Route* to the Lab and/or the Forum; plus publishing Lab solutions, trusting Forum vendors and checking Store listings. Every decision is logged (who, when, what) in SQLite beside jobs and sales.

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
