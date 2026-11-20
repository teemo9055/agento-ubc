# Codebase data-flow audit: where bought data is lost in a Worko multi-step job

NOTE: Plan mode was active, so these notes could not be saved to
`/home/user/agento-ubc/research_notes/Making bought data useful/codebase_dataflow_audit.md`.
They are kept here in full; copy them to that path once you leave plan mode.

Sources are repo files (paths relative to /home/user/agento-ubc) with line numbers, plus read-only queries of `.data/agento.db` (tables `events`, `meta`). "Verified" means read in code or the DB. "Inferred" means reasoned from what was verified.

## 1. How steps run, and whether any step reasons over earlier results

### Takeaway
Steps run as a dependency graph: every step whose refs are met starts at once, in parallel. The only thing that carries data from one step to the next is a mechanical `bind`. A bind copies one value from a fixed JSON path into one whole argument. No model call sits between steps to read what was found and decide what to look up next. This is the core of the user's complaint, and the code bears it out.

### Cited Findings
- Scheduler (verified): `executeNowInNet` loops, starts every `planned` phase whose `dependsOn` are all done or skipped, and races them in parallel (`src/server/orchestrator.ts:660-672`).
- Dependencies come only from refs (verified): `flowOf` builds `dependsOn` from `refsOf(r)`, i.e. the `bind` values and the `when.ref`, plus tie-breaker groups (`src/server/agents/toolbox.ts:162-170`; `src/server/dataflow.ts:46-49`). A step with only fixed `args` has no dependencies, so it starts immediately.
- DB evidence that fixed-query steps ignore step 1 (verified): in business-check run `4edfd404` ("Bay Area Plumbing"), the news step `r5` delivered at seq 19 and the complaints search `r6` at seq 26. Both arrived before the Google step `r1` at seq 33. They could not have used anything `r1` found.
- How a bind fills a typed vendor step (verified): `toolbox.ts:440-458`. For each bound field it calls `resolveRef`. If the value is an array it takes `v[0]` only; if it is an object it skips the step ("Nothing to check"). The string is cut to 300 characters and replaces the whole field (`filled[field] = ...`).
- The ref grammar (verified): `$id.path` with a small JSON path `a.b[0].c` (`dataflow.ts:37-43, 52-68`). It has no string templates, no way to join several refs into one query, and no filtering or choosing among results.
- The only model call that touches inputs (verified): `fillInput`'s `map_inputs` runs only for generic `service` steps (`toolbox.ts:461-469`). It fills only *required fields that are still empty*. Its system prompt says "Fill API input fields ONLY with values that already appear in the known data", and code rejects any value not found verbatim in the earlier results (`dataflow.ts:198-215`). By design it cannot write a new query from earlier facts.
- The "Write it up" phase is not reasoning (verified): for jobs with no action, `templateOf` returns `"answer"` (`src/lib/templates.ts:10-14`) and a `check` phase is added (`toolbox.ts:218`). That phase calls `analyse()`, which only maps each step to `VENDOR_TOOLS[tool].stat(d)` and sets `text: "Data read"` (`toolbox.ts:610-625`). It makes no model call.
- Per-step tone for typed tools is hard-coded to `"neutral"` (verified): only `service` steps get a model-judged tone (`toolbox.ts:494`; `src/server/catalog/tone.ts:109-121`).
- `when` and `onConflict` branching exist but are mechanical comparisons (`dataflow.ts:227-252, 276-294`; `toolbox.ts:430-436`). None of the catalog cards use them (`src/server/jobs.ts:328-401`).

### Inferences
- The run only *executes* a plan written ahead of time. After approval, nothing can say "the news step found a bankruptcy story, so read that article" or "the BBB results list a licence number, so look it up".
- `results[0].link` (company-deep `s2`/`s3`, `jobs.ts:383-384`; `auto-chain.ts` FEEDS for web_search) trusts that the first organic result is the official site. Nothing checks this.

### Gaps
- I did not confirm at runtime whether the chat-composed (non-card) path ever emits `when` or `verify`. The schema allows them (`src/server/tools.ts:457-476`), but I found no live run using them.

## 2. What each paid lookup keeps from the vendor's answer

### Takeaway
Each vendor answer is cut down hard in `web-tools.ts` before it is stored. It is then cut again by each tool's `stat()` before the report sees it. The richest parts of a search answer are never parsed, and some computed figures are misleading because the inputs behind them are thrown away or mixed.

### Cited Findings (verified in code unless marked)
- `webSearch`: asks Serper for `num: 8`, keeps 6 organic results, each `{title ≤120 chars, link, snippet ≤240, date}` (`src/server/web-tools.ts:43-47`). Only `organic` is typed (`:41`). No other part of the Serper answer is read anywhere in `src/` (a grep for `knowledgeGraph|answerBox|peopleAlsoAsk|ratingCount` finds nothing). *Inferred from Serper's public API:* knowledge-graph facts, the answer box, "people also ask" and sitelinks are paid for and dropped.
- `newsSearch`: same shape, 6 stories (`web-tools.ts:49-53`). In run `4edfd404` the stored news items have no `snippet` at all, only title, link, date and source (DB seq 19). The news red-flag rule therefore judged titles alone.
- `placeReviews`: the places call reads only `title, address, phoneNumber, website, cid` from the top hit (`web-tools.ts:65-66`). Reviews are cut to 8, each `{rating, when, text ≤220}` (`:69`). `average` is computed by code from those ≤8 *recent* reviews (`:70-75`). *Inferred:* Google's own overall rating and review count are never read. In the DB run, `r6` shows Yelp with "176 Reviews", while the report says "averages 5★" from 8 reviews.
- `shoppingPrices`: keeps up to 15 priced offers, then computes lowest, median and highest over all 15, but stores only 8 offers (`web-tools.ts:96-101`). Titles are cut to 90 characters. Bundles and different models are not filtered out.
- `imageCheck`: 8 matches `{title ≤110, link, source}` (`web-tools.ts:114`).
- `phoneCheck`: valid, line type, carrier, region and formatted number only (`web-tools.ts:133-134`).
- `companyRecord`: phones ≤4, emails ≤6, `about` ≤240 chars, whois created date (`web-tools.ts:194-209`).
- `readPage`: drops links and images, keeps ≤10 headings and `text.slice(0, 2400)` (`web-tools.ts:227-233`). `stat()` cuts this again to 1600 characters (`src/server/vendor-tools.ts:153-156`).
- `otherOdds`: ≤10 markets (`web-tools.ts:261`). `readListing`: a fixed 7-field extraction prompt (`web-tools.ts:278-279, 296-316`). Shipping, returns, warranty, item specifics and the description are never asked for.
- `stat()` cuts again for the report: web 5 results, news 5 stories, reviews 6, shopping 6 offers, image 5 matches, page text 1600 (`vendor-tools.ts:153-247`). A generic `service` answer becomes a 700-char string (`vendor-tools.ts:41-44, 283-286`).
- `note()` lines shown on the job page are cut to 48 characters (`toolbox.ts:493`). This `finding.text` is also what the code-only report claims and the conflict values use (`src/server/report.ts:91, 130`).

### Inferences
- DB run `2b18af5a` (eBay EcoFlow DELTA 3 Max, $823.75 refurbished) shows the shopping loss clearly. Stored offers include bundles ("+ Solar Panel" at $1,199, "Plus" at $1,449, "2 x DELTA 3" at $1,088). The *same item* new is $854 at both EcoFlow Official and Walmart. The median of $1,059 is pushed up by bundles, and the stored `lowest: 699` does not appear among the 8 stored offers. The report says the price is "well below the typical retail price of $1,059". A person reading the offers would see a refurbished unit only about 3.5% under the new price.

### Gaps
- I could not see raw vendor JSON, so which extra fields Serper and Tomba actually returned on these runs is inferred, not verified. No paid calls were made.

## 3. How query strings are built

### Takeaway
Catalog-card queries are fixed templates filled once from what the person typed, before anything is bought. They are never refined from earlier findings. The binds that do exist pass one raw field through, for example the seller's name as the whole search query.

### Cited Findings (verified)
- `chainCard` fills `{business}`, `{company}` and the other placeholders in args when the job is built (`src/server/jobs.ts:262-277`, shown as `+239 23-37` in the extract). Steps keep any `bind` unchanged.
- business-check: `s5 news_search {query: "{business}"}`, `s6 web_search {query: "{business} complaints license"}` (`jobs.ts:369-370`). These do not use `$s1.found.name`, the address, the phone or the website, even though `s1` finds all four.
- company-deep: `s4 news "{company}"`, `s5 "{company} complaints lawsuit recall"`, `s6 "{company} earnings cash layoffs"` (`jobs.ts:385-387`). None reads `s2` (the site text) or `s3` (company record).
- listing-check: `s4 web_search bind {query: "$s1.seller"}` (`jobs.ts:339`). The query is just the seller's handle. `s2 shopping bind {product: "$s1.searchTitle"}`, made by a regex cleanup of the title (`web-tools.ts:282-293`).
- place-reviews: `s3 news "{place}"` (`jobs.ts:400`).
- Chat-built moves get binds only from the fixed `FEEDS` table (`src/server/auto-chain.ts:9-13, 15-31`). The map is same-field to same-field, and it skips any field the model already filled with text.
- DB run `4edfd404`: `r6` query was `"Bay Area Plumbing San Francisco complaints license BBB"`. It returned BBB profiles for *other* plumbers (Advanced Plumbing & Drain, X-Ray, A-1 Bay Area Plumbing with licence 1116691, Warrior). The business's own site snippet said "Licensed … since 1995", but no licence number was found. No step followed up. The report's `nextSteps` then tells the person to "Call (415) 668-8000 to ask for their … CSLB license number" and "Verify their license standing … on the CSLB website". That is the check the paid job set out to do.

### Inferences
- Because queries are set before any data arrives, a search can't be narrowed by what was found. Examples: the exact registered name, the address, a licence number in a snippet, the domain found in step 1, or the product model rather than the listing title. This is the main reason results read like "basic info anyone could Google".

### Gaps
- None material.

## 4. What the final report sees

### Takeaway
The report is a single model call at the very end. Its input is each delivered step's already-cut `stat()` view, stringified and then hard-cut at 6,000 characters in step order. It also gets the approved `ask`, the first message, code signals and conflicts. It gets no list of questions the job must answer, no step `why`s, no plan `why`, and no chat facts. Code rules (`signals.ts`) set a verdict floor that the model may not soften, and some of those rules misfire.

### Cited Findings (verified)
- `delivered()` keeps only done phases with a settled, unrefunded payment and a result (`report.ts:17`).
- `viewOf()` uses `VENDOR_TOOLS[tool].stat(data)`, or else `digest()` cut to 1,200 characters (`report.ts:20-32`). `digest()` reduces lists longer than 12 items to count, first 3, last 3 and number ranges (`report.ts:42-53`).
- The prompt (`report.ts:139-157`) has seven inputs. It includes `What they approved: ${proposal.ask}` and `(They first asked: ${task})`, the `act` note, conflicts, signals, and `Answers by step: ${JSON.stringify(data).slice(0, 6000)}`. The cut can land mid-JSON and always drops the *last* steps first.
- Rules in the prompt: "claims: 4-8 statements … Only say what those answers say; never add facts. Connect stages where one explains another" (`report.ts:146`). The rule "never add facts" is enforced afterwards by the number check (`report.ts:160-168`, `grounding.ts`).
- Size check (computed from DB run `4edfd404` with the same `stat()` shapes): r5 1,152 + r6 1,801 + r1 1,795 + r2 201 + r4 180 = about 5,160 characters. That fit because `read_page` (r3) was skipped. *Inferred:* had r3 delivered, its view (≤1,600 text plus headings and URL, about 2,000 characters) would push the total past 6,000. Then r5 and r6 (news and complaints) would be cut, since phases are in r1 to r6 order.
- An earlier, redundant model call (verified): `finish()` first runs `aiSummary` over `compact(deliverable.data)` with up to **12,000** characters of data (`orchestrator.ts:683-690`; `src/server/agents/ai-planning.ts:29-37`). It then overwrites `deliverable.summary` with the report headline (`orchestrator.ts:711`). That summary call sees twice as much data as the report.
- `signals.ts` (verified) applies fixed rules per tool:
  - phone line type (`:33-39`)
  - company record missing → **warn**, domain under 1 year → bad, 3 years or more → good (`:42-47`)
  - phone matches the company's numbers (`:50-59`)
  - review average below 3.5 or at least 4.3, and 2 or more low reviews (`:62-71`)
  - listing price against store median (`:74-88`)
  - seller feedback (`:91-96`)
  - copied photo (`:99-104`)
  - `RED_WORDS` regex on news titles and snippets → **warn** (`:16, 107-111`)
  - odds and oracle (`:114-145`)
  - thin page (`:148`)

  `floorOf`: 1 bad or 2 warns → at least `be_careful` (`report.ts:67-72`).
- DB run `4edfd404` shows the floor misfiring:
  - The news hit was "Longtime Bay Area Plumbing Contractor Serving Multiple Cities Files for Chapter 11 Bankruptcy" (whatnow.com). Its title does not name this firm.
  - Tomba had no record for the small local domain (`found:false`).
  - Those two warns set the floor to `be_careful`. The headline says the firm "shares a headline with a recent Chapter 11 bankruptcy filing".
  - No step read that article to check which company it was about.
- Gaps and plan intent: `gapsOf` lists `proposal.gaps` and skipped or failed phases (`report.ts:101-110`). `compose.facts` questions are used only to *label* conflicts (`report.ts:89`). They are not given to the model as questions to answer.

### Inferences
- The model is asked to write "4-8 claims" from snippets. It is not asked to answer the person's actual questions, such as "Are they licensed?", "Is this the same company as the bankruptcy?" or "What does the same item cost new?". The report therefore restates what each step returned instead of drawing a conclusion.

### Gaps
- The stored listing-run signal reads "in line with the typical $1,059". Current code would say "22% below … a good price" for a ratio of 0.78 (`signals.ts:86-87`). The rule text has likely changed since that run (inferred).

## 5. Plan-time reasoning that is not carried into the run

### Takeaway
Catalog cards are built entirely by code with fixed intro text (`jobs.ts:12-16, 262-277`), so there is little plan-time thinking to lose. For chat-built jobs, the planning model's free-lookup facts, its reasoning text and the plan's `why` stay in the chat. The run and the report never read them.

### Cited Findings (verified)
- Chat turns keep `facts` from free tools (≤1,500 characters, `explore.ts:295, 313-314, 375`) and replay them only into later *chat* turns (`explore.ts:143-157`).
- `factsFrom` keeps notes only for market, spot and place tools (`explore.ts:162-185`).
- The report prompt reads `proposal.ask` and `run.task` only (`report.ts:156`). It never reads `proposal.why`, step `why`s, `run.chat`, `ChatMsg.facts` or `Brief` (a grep of `report.ts`, `signals.ts` and `verdict.ts` for chat, brief, why and lanes finds only the conflict label and the tally).
- `compose.facts` (questions with must/should/nice importance) become `run.lanes` (`orchestrator.ts:318-320`). They feed only the verdict tally weights (`src/server/verdict.ts:11-32`) and the model tone question for `service` steps (`toolbox.ts:494`). They do not feed the report prompt.
- Proposal `givens` are used for binds (`toolbox.ts:428`) and to label inputs.

### Inferences
- The "think for a moment" the user sees at plan time is the chat model using free tools (and, for cards, fixed intro copy). After approval, the run is the fixed step list plus one final summary. Any intent the planner had (what to check, why, which facts matter) is gone by the report unless it was frozen into an `ask` string.

### Gaps
- I did not trace `src/server/catalog/*` (the capability-map composer) in detail. `ComposeTrace` holds only facts, counts and timing (`src/lib/types.ts:292-301`), so it carries no reasoning text either way.

## 6. Reuse of bought data across jobs and follow-ups

### Takeaway
Bought data is effectively single-use. Once a job is approved, the chat on it is closed. Nothing indexes past results for later jobs. Watches and "run again" pay again.

### Cited Findings (verified)
- `sendChat` throws "this job is already running" unless the status is `exploring` or `draft` (`orchestrator.ts:346-349`). A finished job cannot be asked a follow-up.
- `run.results` is per run (reducer `src/lib/reducer.ts:76` stores `data.received` under `results[phaseId]` and `feed[key]`). The purchase cache `ctl.cache` is per run (`orchestrator.ts:864, 965, 1001`).
- The knowledge layer is primers, playbooks and "lessons" from *orders and settlements* only (`src/server/knowledge.ts:9, 13-45, 114-148, 151`). Nothing records research results.
- Watches copy the steps a ref needs and buy them again on a schedule, comparing one value (`src/server/watches.ts:70-85, 150-170`).
- `rerun` validates the same proposal again and creates a new run that buys again (`orchestrator.ts:1704-1716`).
- The `learned_recipes` table exists in the DB (verified via `sqlite_master`), but no file under `src/` references it (grep). *Inferred:* the learned-recipe feature was removed and the table is left over.

### Inferences
- A person who wants to ask "So is the bankruptcy them?" must start a new job and pay again. Even then, the new job cannot see the old answers.

### Gaps
- None material.

## 7. Ranked gaps that most reduce usefulness, each with the smallest fix

Each gap pairs a problem with the smallest code change that would address it.

1. **No reasoning between steps; queries frozen before data arrives.** Today business-check `s5`/`s6` and company-deep `s4`-`s6` run blind (`jobs.ts:369-370, 385-387`; DB shows r5 and r6 finished before r1).
   - Smallest fix: allow *templated* binds, a string with several refs such as `"{$s1.found.name} {$s1.found.address} contractor license"`. Do the interpolation in the typed-step bind loop (`toolbox.ts:440-458`), and in `refsOf` (`dataflow.ts:46-49`) so dependencies follow.
   - Then change the card templates to bind on `s1`'s findings.
2. **No follow-up step chosen from results.** Today nothing reads the bankruptcy article, the BBB licence entry or the right search result.
   - Smallest fix: add one model "next look" step type. It runs after the find stage, sees the `stat()` views and the job's questions, and returns at most 1-2 extra typed lookups (for example a `read_page` on a chosen link, or a `web_search` for a licence number), priced within a pre-approved reserve.
   - Alternatively, extend `map_inputs` (`dataflow.ts:199-216`) to typed steps and allow choosing *which* result index to bind.
3. **Report starved and unfocused.** Today the global `slice(0, 6000)` drops the last steps, and there are no questions and no plan intent (`report.ts:136, 156`).
   - Smallest fix: give each step its own budget (for example `6000 / n` per step, cutting inside `viewOf`).
   - Add `run.lanes` questions, or the step `why`s, plus `proposal.why` to the prompt, with "answer each question, or say it's unanswered".
   - Drop or merge the redundant `aiSummary` call (`orchestrator.ts:683-690`), which already gets 12,000 characters.
4. **Code rules misfire and force the verdict.** News `RED_WORDS` fires on titles about other firms (`signals.ts:107-111`). Company-record-missing warns for small local businesses (`signals.ts:44`). Two warns set `be_careful` (`report.ts:67-72`).
   - Smallest fix: require the business or company name (from `s1.found.name` or the givens) to appear in the story title or snippet before warning.
   - Make `!found` neutral when `place_reviews` found the business.
5. **Misleading computed numbers from trimmed or mixed vendor data.**
   - Shopping median includes bundles, and stored offers don't include the lowest (`web-tools.ts:96-101`). Smallest fix: drop offers whose title lacks the model tokens of `searchTitle` (or contains "+", "bundle", "2 x") before lowest, median and highest; store the offers the stats came from.
   - Places average is computed from ≤8 recent reviews (`web-tools.ts:65-75`). Smallest fix: also read Serper's `rating` and `ratingCount` from the places hit and keep them next to `average`.
6. **Search answers stripped of the useful parts.** Only `organic` 6×(120/240 chars) is kept (`web-tools.ts:41-46`).
   - Smallest fix: also keep `knowledgeGraph` (type, description, attributes) and `answerBox` when present. Both are small, and `stat()` should pass them on.
7. **Bought data is single-use.** Today follow-ups are blocked (`orchestrator.ts:348`) and there is no store of results (`knowledge.ts`).
   - Smallest fix: on `done` runs, allow a "follow-up" chat that answers only from `run.results` (reuse `viewOf` + `digest`), with no paid tools.
   - Later: index `run.results` by givens (domain, phone, place) so a new job can reuse a fresh answer instead of buying it again.
8. **Short finding text.** The 48-character `note` cut (`toolbox.ts:493`) is what the code-only report and conflicts show (`report.ts:91, 130`).
   - Smallest fix: store the full `note()` and cut only in the UI.
