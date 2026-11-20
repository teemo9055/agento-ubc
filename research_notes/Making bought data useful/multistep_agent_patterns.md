# Multi-step research agents that build on what they bought: patterns for Agento

> Status note: plan mode was active in this session, so these notes could not be written to `/home/user/agento-ubc/research_notes/Making bought data useful/multistep_agent_patterns.md`. They are staged here. Copy them over unchanged once edits are allowed.
>
> Network note: only some hosts could be fetched. anthropic.com and github.com loaded. arxiv.org, huggingface.co, exa.ai, langchain.com and blog.langchain.com did not resolve in this session, so for those I used search-result snippets. Items marked **[background, not fetched]** are standard papers cited from prior knowledge. Their URLs are the canonical arXiv pages, but I did not re-read them this session.
>
> Running example used throughout: "Check a company: Coresignal (firmographics/headcount) → PredictLeads (job openings, news events, tech) → Exa (web search/verification) → summary."

---

## Q1. How do the leading deep-research systems structure the loop (plan → act → think → re-plan, decomposition, deepening, stopping)?

### Takeaway
Every strong system shares one shape. It **scopes** the question into a written brief or plan, then **loops** search → reflect after each tool result → refine the next query, then **compresses** each branch into notes, and only then **writes**. The step Agento skips is the reflect step between tool calls: an LLM reads the last result and decides the next call's arguments, so a template does not decide them. Stopping is either explicit (a "research complete" tool, the model judging there is enough) or a hard budget cap.

### Cited Findings

**Anthropic's multi-agent research system (June 2025, current reference design)**
- A lead agent analyzes the query, develops a strategy, and spawns subagents that search in parallel. Subagents "act as intelligent filters" and return condensed findings. Anthropic contrasts this multi-step, adaptive retrieval with "static" chunk retrieval in classic RAG. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- The lead uses extended thinking as a scratchpad to pick tools, judge complexity, set the number of subagents and define each one's role. It saves its plan to memory because contexts over 200,000 tokens get truncated. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Subagents plan, then use **interleaved thinking after each tool result** to "evaluate quality, identify gaps, and refine their next query." — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Effort-scaling rules sit in the prompt. Simple fact-finding gets 1 agent with 3–10 tool calls. Direct comparisons get 2–4 subagents with 10–15 calls each. Complex research gets more than 10 subagents with divided responsibilities. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- "Start wide, then narrow down": short, broad queries first, then progressively narrower ones. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Each delegated task needs an objective, an output format, tool/source guidance and clear boundaries. Vague instructions caused duplicated work and gaps. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Guardrails were needed: early versions spawned 50 subagents for simple queries. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Performance: an Opus 4 lead with Sonnet 4 subagents beat single-agent Opus 4 by 90.2% on Anthropic's internal research eval. On BrowseComp, token usage alone explained 80% of performance variance, and token usage, tool-call count and model choice together explained 95%. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Cost: agents use about 4× the tokens of chat and multi-agent systems about 15×, which pays off only for high-value, parallelizable tasks. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)

**LangChain open_deep_research (2025; #6 on Deep Research Bench as of Aug 2025)**
- Three phases: (1) scope, meaning optional clarification plus a **research brief** that seeds the supervisor; (2) research, where a supervisor delegates to sub-researchers; (3) a one-shot final report. — [DEV Community architecture guide](https://dev.to/bolshchikov/open-deep-research-internals-a-step-by-step-architecture-guide-2ibk); [LangChain blog (via search snippet)](https://blog.langchain.com/open-deep-research)
- The supervisor has three tools: `think_tool` (strategic reflection), `ConductResearch` (delegate a topic to a sub-researcher) and `ResearchComplete` (an explicit stop signal). — [DEV Community architecture guide](https://dev.to/bolshchikov/open-deep-research-internals-a-step-by-step-architecture-guide-2ibk)
- Each researcher ends with `compress_research`, which turns its findings into a concise summary and prunes irrelevant tokens before returning. The chat history is compressed into the brief to prevent token bloat. — [DEV Community](https://dev.to/bolshchikov/open-deep-research-internals-a-step-by-step-architecture-guide-2ibk); [LangChain blog snippet](https://blog.langchain.com/open-deep-research)
- Separate model roles: summarization (default gpt-4.1-mini, summarizes raw search results), research, compression, and final report. — [GitHub repo](https://github.com/langchain-ai/open_deep_research)
- RACE scores: 0.4943 with GPT-5, 0.4401 with Claude Sonnet 4, 0.4309 with defaults, 0.4344 for the leaderboard submission at a total cost of $87.83. The README calls the older supervisor-researcher multi-agent version in `src/legacy/` "less performant". — [GitHub repo](https://github.com/langchain-ai/open_deep_research)

**Gemini Deep Research**
- It shows an editable **research-plan card** before browsing. Google added an edit button because testers missed that the plan could be changed, though most users still just start. — [Latent Space write-up](https://latent.space/reading/inventors-deep-research/); [Gemini overview](https://gemini.google/overview/deep-research/)
- An asynchronous task manager keeps **shared state between planner and task models**, so one failure doesn't restart the whole task. — [Gemini overview](https://gemini.google/overview/deep-research/) (search snippet)
- The loop is described as: browsing yields intermediate information, that information changes the plan, and the revised plan triggers more calls. The model must "ground itself on all information gathered so far, then identify missing information and discrepancies it wants to explore." — [AI Engineer talk](https://ai.engineer/talks/how-deep-research-works); [Gemini overview](https://gemini.google/overview/deep-research/) (search snippets)
- Caveat: these are mostly self-reported, early-2025 descriptions. Google's current pages don't detail the task manager.

**OpenAI deep research**
- It runs on an early o3 optimized for web browsing; the system card is dated Feb 25, 2025. It is not allowed to construct arbitrary URLs, which limits exfiltration after a prompt injection. — [OpenAI system card](https://openai.com/index/deep-research-system-card/)
- BrowseComp: deep research scores 51.5%, against 9.9% for o1 and 0.6% for GPT-4o, and it was trained on BrowseComp-like tasks. Accuracy scales smoothly with test-time compute. — [OpenAI BrowseComp](https://openai.com/index/browsecomp/)

**STORM (Stanford, NAACL 2024, foundational)**
- Pre-writing pipeline: (1) discover perspectives from related articles; (2) simulate conversations in which a writer with each perspective asks questions of a grounded "expert," with follow-up questions arising from earlier answers; (3) curate the collected material into an outline before writing. — [STORM project page](https://storm-project.stanford.edu/research/storm/); [arXiv 2402.14207](https://arxiv.org/abs/2402.14207)
- Against an outline-driven RAG baseline, 25% more articles were rated organized and 10% more broad in coverage (absolute gains, on the authors' FreshWiki set; no independent replication found). Stated limits: source-bias transfer and over-association of unrelated facts. — [arXiv 2402.14207](https://arxiv.org/abs/2402.14207) (search snippet)

**GPT Researcher**
- It uses "planner" and "execution" agents. The planner generates research questions, executors gather information and the publisher aggregates. Its Deep Research mode is recursive, with breadth and depth, at roughly 5 minutes and $0.40 per run with o3-mini high. — [GitHub README](https://github.com/assafelovic/gpt-researcher)

**Foundational loop papers [background, not fetched]**
- ReAct interleaves "Thought → Action → Observation" so each observation shapes the next action. — [arXiv 2210.03629](https://arxiv.org/abs/2210.03629)
- Self-Ask has the model ask itself explicit follow-up sub-questions and answer each before the final answer. — [arXiv 2210.03350](https://arxiv.org/abs/2210.03350)
- Plan-and-Solve plans sub-tasks first, then executes them. — [arXiv 2305.04091](https://arxiv.org/abs/2305.04091)
- Reflexion stores verbal self-critique in memory and uses it on the next attempt. — [arXiv 2303.11366](https://arxiv.org/abs/2303.11366)

### Inferences
- **Agento's gap matches the user's complaint exactly.** Agento has a planner (the plan step) and a writer (the final LLM write-up) but no reflect step between paid calls. Mechanical bindings like `search[0].link` are the static retrieval Anthropic contrasts with adaptive retrieval. The minimum fix is a cheap "think" call after each paid step. It reads the result plus the brief, updates the notes, and emits typed arguments for the next step, or decides to skip it, stop or re-plan.
- **A pattern to adopt: "plan-of-record plus re-plan diff."** Keep the user-approved plan, which Gemini also uses as a scope agreement. Let the think step propose changes, such as a new query or a dropped or added step. Auto-apply changes under the remaining budget, and send anything that adds spend back for approval.
- Applied to the example. After Coresignal returns "Acme Inc, 180 staff, headcount −22% over 12 months, HQ Berlin", the think step writes: "Headcount shrinking. Check whether hiring has stopped and whether there is layoff or funding news." It then sets PredictLeads arguments to `{domain: acme.io, event types: layoffs, funding, leadership change; job openings since 2025-11}` and writes the Exa query "Acme Inc acme.io layoffs OR restructuring 2026". These replace "search for the company name".
- An explicit stop tool (`ResearchComplete`) plus a hard budget cap is the common stopping design. Agento can use a "decision questions all answered at or above the required confidence" check as its stop condition (see Q4).

### Gaps
- Perplexity's internal loop isn't publicly documented. I found only its citation-accuracy result (Q8).
- Co-STORM, the collaborative STORM variant with a "mind map" of collected knowledge (arXiv 2408.15232), could not be fetched. The mind-map detail is from background knowledge and unverified here.
- I couldn't fetch open_deep_research `configuration.py`. Parameter names such as `max_researcher_iterations`, `max_react_tool_calls` and max concurrent research units are known from background, but their defaults are unverified.
- The OpenAI system card doesn't describe the internal plan/re-plan mechanics. The visible behavior (pivoting as it browses) is documented only informally.

---

## Q2. Interim synthesis: working memory or notes after each stage, deciding the next query, flagging contradictions and gaps, and staying grounded

### Takeaway
Proven systems don't pass raw tool output forward. After each stage, a small model **summarizes or compresses** results into notes that keep their source references. The planner reads the notes, not the raw data, to choose the next query. Grounding comes from (a) keeping source ids attached to every extracted fact, (b) storing large outputs outside the context and passing references, and (c) a separate citation or verification pass at the end.

### Cited Findings
- open_deep_research runs a dedicated summarization model over raw search results, and each researcher compresses its findings before returning to the supervisor. — [GitHub repo](https://github.com/langchain-ai/open_deep_research); [DEV Community](https://dev.to/bolshchikov/open-deep-research-internals-a-step-by-step-architecture-guide-2ibk)
- Anthropic has subagents write outputs to external storage and pass "lightweight references" back to the coordinator. This avoids a "game of telephone", preserves fidelity and cuts tokens. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Anthropic saves the lead's plan to memory and can start fresh subagents that retrieve it when context runs out. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- A separate CitationAgent processes the documents and the report to find where each claim's citation belongs. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Gemini's model "identif[ies] missing information and discrepancies" from everything gathered so far before choosing more calls. — [Gemini overview](https://gemini.google/overview/deep-research/) (search snippet)
- Exa Websets returns each item with structured properties plus verification against your criteria, "with reasoning and references explaining why it matches". Exa's newer Agent API returns `output.structured`, `output.text`, `output.grounding` (citations) and `costDollars`. — [Exa Websets docs](https://exa.ai/docs/websets/api-guide); [Exa migration guide](https://exa.ai/docs/.mintlify/skills/build-with-exa/references/migrate-websets-to-agent.md) (search snippets)
- STORM curates gathered Q&A into an outline before writing, so the structure comes from the evidence. — [STORM project page](https://storm-project.stanford.edu/research/storm/)
- File-system-based research agents (FS-Researcher, 2026) persist notes to files as working memory for long-horizon tasks. — [arXiv 2602.01566](https://arxiv.org/pdf/2602.01566) (title and snippet only)

### Inferences
- **Recommended shape for Agento: an evidence ledger plus a running brief.** Two objects travel between steps:
  1. A **Fact table**, append-only, where every row comes from one paid call:
     `{fact_id, entity_id, field, value, unit, as_of, source: {vendor, call_id, url?}, method: "api-field" | "llm-extracted", confidence}`
  2. **Working notes**, rewritten by the think step after each stage:
     `{answered: {q_id: [fact_ids]}, open_questions, contradictions: [{fact_a, fact_b, note}], hypotheses, next_calls: [{vendor, args, why, est_cost, expected_to_change: q_id}]}`
- The writer only gets the Fact table plus notes. Every sentence must cite `fact_id`s, and a final check rejects claims with no id, as Anthropic's citation pass does. This keeps the LLM synthesis grounded in what was bought, without re-reading raw payloads.
- Applied to the example:
  - After Coresignal: F1 `headcount=180 (2026-10)`, F2 `headcount_12m_change=-22%`, F3 `hq=Berlin`.
  - After PredictLeads: F4 `open_jobs=14, 9 sales`, F5 `event: "raised Series B" 2026-03`.
  - Contradiction flagged: "headcount falling 22% while hiring 9 sales roles and raising in March. Either a restructure toward go-to-market, or a stale headcount."
  - The next Exa query is then chosen to resolve that contradiction ("Acme restructuring sales expansion 2026"). A generic company search is not enough.

### Gaps
- No public source gives a canonical "fact table" schema used by OpenAI, Google or Anthropic. The ledger schema above is my synthesis.
- I found no quantitative ablation isolating "interim notes vs raw context" for paid-API enrichment specifically. The evidence is general (Anthropic's telephone-game note, the compression stage in open_deep_research).

---

## Q3. Entity resolution: pinning the subject to a canonical ID before enrichment

### Takeaway
Industry practice is **resolve first, then enrich**. One cheap call maps the messy input (name, URL, LinkedIn) to a canonical identity (domain plus vendor ID) with a confidence score. Every later call is keyed on that ID, and low-confidence matches stop for review instead of buying enrichment on the wrong company.

### Cited Findings
- Crustdata treats company entity resolution as a pre-enrichment step. Its argument is that enrichment calls on an unresolved identity burn credits on the wrong company and contaminate records. — [Crustdata blog](https://crustdata.com/blog/company-entity-resolution-messy-inputs)
- Crustdata's Identify API accepts a domain, name, profile URL or company ID and returns ranked matches by confidence, to be used before enrichment. — [Crustdata docs](https://docs.crustdata.com/company-docs/identify/introduction)
- Explorium splits **match** (returns only a canonical `business_id`) from **enrich** (firmographics), to keep matching fast and enrichment flexible. — [Explorium](https://www.explorium.ai/?p=19565) (search snippet)
- Apify's Company Identity Resolver maps name, domain or LinkedIn to one identity tuple with a 0–100 confidence score, and uses the canonical domain as a dedup and join key. — [Apify](https://apify.com/mambalabs/company-identity-resolver)
- LinkedIn's organization entity resolution runs request handling → candidate retrieval → feature computation → candidate ranking. — [LinkedIn Engineering](https://engineering.linkedin.com/blog/2022/matching-external-companies-to-linkedin-s-economic-graph-at-scal) (foundational, 2022)
- S&P Kensho Link maps a company universe to S&P identifiers for scalable enrichment. — [S&P Global Marketplace](https://www.marketplace.spglobal.com/en/solutions/kensho-link-(2d7177f8-ada7-4c1c-b360-b33951f57248))

### Inferences
- **Pattern: "Pin step" as step 0.** Turn the user's input into `entity = {canonical_domain, name, coresignal_id, linkedin_url, match_confidence, alternatives[]}`. If confidence is below a threshold or the top two candidates are close (for example "Acme Inc" in Berlin vs "Acme Corp" in Ohio), the job pauses with a chip picker: "Which Acme did you mean?" It does not spend.
- All later steps take `entity.canonical_domain` or IDs as arguments. PredictLeads and Exa are keyed by domain, and Exa queries add `site:` or domain filters. This directly replaces "use the first search result's link", which is the riskiest binding in Agento today because the first search hit is often a namesake, an aggregator or a news page.
- A cross-check fact, `coresignal.website == predictleads.domain == exa top result domain`, belongs in the Fact table as an identity-confirmation row. A mismatch is a contradiction to show the user.

### Gaps
- I found no published LLM-agent-specific study measuring wrong-entity rates with and without a pinning step. The cost argument comes from vendor blogs, which have a commercial interest.
- I didn't verify which of Coresignal, PredictLeads or Exa expose a dedicated "identify/match" endpoint. Check each vendor's docs.

---

## Q4. Question-driven reports: decision questions up front, answers with evidence, confidence and "not found", and analyst-style output

### Takeaway
The evidence supports writing the questions before the research. That means a research brief (open_deep_research), a perspective set (STORM) or a plan the user can edit (Gemini). Evaluation frameworks reward **insight** and **instruction-following**, not just coverage. For a decision product, the report should be a fixed set of decision questions, each answered with cited facts, a confidence level and an explicit "not found", followed by so-what analysis.

### Cited Findings
- open_deep_research compresses the user request into a **research brief** that drives all research. — [DEV Community](https://dev.to/bolshchikov/open-deep-research-internals-a-step-by-step-architecture-guide-2ibk)
- Gemini's plan card works as an editable scope agreement before any browsing. — [Latent Space](https://latent.space/reading/inventors-deep-research/)
- STORM uses perspectives to focus the questions asked and generates an outline from the gathered answers. Experts rated its breadth and organization higher than outline-driven RAG. — [STORM project page](https://storm-project.stanford.edu/research/storm/)
- DeepResearch Bench's RACE scores reports on **comprehensiveness, insight/depth, instruction-following and readability** against expert reference reports, with task-specific weighted criteria. — [DeepResearch Bench](https://deepresearch-bench.github.io); [arXiv 2506.11763](https://arxiv.org/pdf/2506.11763) (search snippets)
- Anthropic's rubric includes **completeness**, meaning whether all requested aspects are covered. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Exa Websets criteria must be things "that can be confirmed from publicly available web content". It recommends 1–3 criteria, max 5, and each verified item comes with reasoning and references. In effect it is a yes/no question answered with evidence per entity. — [Exa Websets best practices](https://exa.ai/docs/websets/best-practices) (search snippet)

### Inferences
- **Pattern: "Decision card" report.** At plan time the planner writes 3–6 decision questions tied to the user's goal. Example: "Is Acme a safe 12-month vendor?" becomes Q1 growing or shrinking, Q2 funded or runway risk, Q3 leadership stable, Q4 any red-flag news, Q5 do they actually sell X. Each answer block shows:
  - an answer (Yes / No / Mixed / **Not found**)
  - confidence (High/Med/Low, with a reason such as "two independent sources agree")
  - evidence chips linked to `fact_id`s
  - **so-what**, meaning what it implies for the user's decision
  - **baseline or trend**, for example "−22% headcount vs a typical ±5% for B2B SaaS of this size" (only if a baseline was actually bought or is user-supplied, never invented)
  - **what would change this answer**, meaning the next call worth buying
- "Not found" must be a first-class answer. It separates "searched and absent" (evidence of absence, with the calls listed) from "not searched" (a budget limit). That keeps the report honest and makes the next purchase obvious.
- Analyst style means leading with the verdict and risks, then the evidence. Restating each vendor's fields is the "pile of lookups" the user dislikes. RACE's "insight" dimension is a public proxy for this.

### Gaps
- I found no public study comparing a "decision-question template" with free-form deep research reports on user decision quality. RACE's insight dimension is the nearest proxy.
- I didn't find a documented, reusable "confidence calibration" scheme in any of the named systems.

---

## Q5. Data fusion that creates insight across sources (derived metrics, cross-checks, timelines, contradictions)

### Takeaway
Leading systems explicitly look for **discrepancies** across sources (Gemini) and verify claims against sources (Exa criteria, Anthropic's citation pass, FACT). STORM warns that LLMs over-associate unrelated facts. So fusion should be done deterministically where possible (computed metrics, timeline merges, equality checks), with the LLM writing interpretation over computed results, not doing arithmetic or joining in free text.

### Cited Findings
- Gemini Deep Research is described as identifying "missing information and discrepancies" across everything gathered. — [Gemini overview](https://gemini.google/overview/deep-research/) (search snippet)
- STORM's authors flag "over-association of unrelated facts" and "source bias transfer" as failure modes of LLM synthesis. — [STORM project page / README](https://storm-project.stanford.edu/research/storm/) (search snippet)
- Clay's waterfall validates each provider's result before accepting it and falls through to the next provider if invalid. This is a cross-source check built into the pipeline. — [Clay waterfall guide](https://www.clay.com/guides/waterfall-enrichment)
- Exa verification attaches reasoning and references per criterion. — [Exa docs](https://exa.ai/docs/websets/api-guide) (search snippet)

### Inferences
- Fusion operations for the company example, with their inputs and outputs:
  - **Derived metric:** jobs-to-headcount ratio = PredictLeads open jobs ÷ Coresignal headcount (14/180 ≈ 7.8%). Headcount trend comes from Coresignal history.
  - **Cross-check:** Coresignal HQ vs PredictLeads location vs Exa "about" page. Coresignal founded year vs Exa.
  - **Timeline:** merge dated events (PredictLeads news events, Exa articles, Coresignal headcount snapshots) into one sorted list. Example: "2026-03 Series B → 2026-06 VP Sales hired → 2026-09 headcount −22% → 2026-10 9 sales roles open". Reading this timeline is what produces the "restructuring toward sales" insight.
  - **Contradiction:** "Exa article says acquired in 2026-08, but PredictLeads shows no M&A event." This becomes a flagged item with both fact_ids and drives an optional verify call.
- Compute derived metrics in code and store them as Fact rows with `method: "derived"` and `inputs: [fact_ids]`. The model then explains them but never computes them, which matches the "Check numbers in replies" work already in Agento.

### Gaps
- No vendor-neutral published taxonomy of "fusion operations" for research agents was found. The list above is synthesis.
- No measured evidence that timelines specifically improve user decisions was found.

---

## Q6. Cost control when each call is paid: budget-aware planning, value of information, approval gates

### Takeaway
The current research says that **giving an agent a bigger budget does not by itself help**. Making the agent **aware of its remaining budget** and having it decide to dig deeper or pivot cuts paid calls substantially at the same accuracy. Value-of-information scoring, "buy the next call only if it can change the answer", is now an explicit research direction (2026). In production enrichment, the cheapest proven pattern is the **waterfall**: try sources in cost or quality order and stop at the first valid result.

### Cited Findings
- **BATS / Budget Tracker** (UCSB + Google, arXiv 2511.17006, Nov 2025): simply granting a larger tool-call budget fails to improve performance. A budget tracker plug-in plus a budget-aware strategy achieves comparable accuracy with 40.4% fewer search calls and 19.9% fewer browse calls, and cuts overall cost by 31.3%. — [VentureBeat coverage](https://venturebeat.com/ai/googles-new-framework-helps-ai-agents-spend-their-compute-and-tool-budget); [arXiv 2511.17006](https://arxiv.org/abs/2511.17006v1) (snippets; full text not fetched)
- **Inference-Time Budget Control for LLM Search Agents** (arXiv 2605.05701, May 2026): a controller assigns each feasible action (retrieve, decompose, commit to an answer) a task-level **value-of-information** score, with separate search-time and answer-time budget control. — [arXiv 2605.05701](https://arxiv.org/html/2605.05701) (snippet; not fetched)
- Related: BAVT, a budget-aware value tree search (arXiv 2603.12634), and INTENT, which uses world-model lookahead to enforce hard cost budgets in tool use (arXiv 2602.11541). — [arXiv 2603.12634](https://arxiv.org/pdf/2603.12634); [arXiv 2602.11541](https://arxiv.org/pdf/2602.11541) (titles and snippets only)
- Directly on-domain: "Paying to Know: Micro-Transaction Markets for Verified Product Information in Agentic E-Commerce" (arXiv 2606.24783). — [arXiv 2606.24783](https://arxiv.org/pdf/2606.24783) (title only; not read)
- Clay waterfall: query providers one at a time and stop at the first confident result, billed only for the lookup that returns it (per Clay). Community reports conflict: some users were charged for failed attempts plus validation. A free "Infer Email" guess can run before any paid provider. — [Clay guide](https://www.clay.com/guides/waterfall-enrichment); contradicted in part by [Clay community thread](https://community.clay.com/x/support/h13ny8xdwobq/understanding-clays-waterfall-enrichment-credits-u)
- Anthropic's effort-scaling rules (1 agent and 3–10 calls for simple tasks, and so on) and its guardrail against over-spawning are a prompt-level budget policy. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Exa's Agent API returns `costDollars` per run, so spend can be fed back into the loop. — [Exa migration guide](https://exa.ai/docs/.mintlify/skills/build-with-exa/references/migrate-websets-to-agent.md) (snippet)

### Inferences
- **Pattern: think step outputs a priced shortlist.** Each candidate next call carries `{est_cost, which decision question it can move, current confidence on that question}`. Buy it only if it can change an unanswered or low-confidence question. Skip it if every question is already answered at High confidence. Show the remaining budget in the think prompt, which is the BATS idea.
- **Free-first, then cheap-first waterfall** per question. Example for "is Acme funded?": already-bought facts and cache, then PredictLeads funding events (cheap, structured), then Exa search (only if still unknown).
- **Approval gates:** the approved plan sets a spend ceiling. Re-plans that stay under it run automatically. Anything over it, or a new vendor, goes back to the user with the reason ("Headcount fell 22%. Spend $0.04 more on news to find out why?"). This fits Agento's existing approval and passkey flow.
- Record actual cost per call in the Fact table's source, so the report can show "this answer cost $0.03".

### Gaps
- BATS and 2605.05701 full texts weren't readable here (arxiv and huggingface blocked). The numbers come from VentureBeat and search snippets.
- No public data on dollar savings from VOI gating on paid data APIs (as opposed to search calls) was found.

---

## Q7. Reuse: follow-up questions over already-bought data without paying again

### Takeaway
The reference systems store intermediate results outside the context and pass references (Anthropic). Plans and state persist across failures (Gemini's shared-state task manager). Production enrichment tools charge nothing when you supply your own cached or own-key data (Clay). For Agento, the bought Fact table is the asset: follow-ups should query it first and buy only the deltas.

### Cited Findings
- Subagent outputs are stored externally, and lightweight references are passed to the coordinator. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- Gemini keeps shared state between planner and task models, so failures don't restart the task from the beginning. — [Gemini overview](https://gemini.google/overview/deep-research/) (snippet)
- With your own API keys in Clay, 0 Clay credits are consumed, so where the data and key live changes cost. — [Clay community](https://community.clay.com/x/support/understanding-clays-waterfall-enrichment-credits-u) (search snippet)
- Exa Websets supports excluding or importing prior results and monitors for ongoing updates, per its docs index. — [Exa Websets API guide](https://exa.ai/docs/websets/api-guide) (snippet; detail unverified)

### Inferences
- **Pattern: "answer from the ledger first."** A follow-up such as "how does their hiring compare to last quarter?" runs the think step against the existing Fact table. If the facts are there, the answer is free and cites the old `fact_id`s, labelled with their `as_of` date. If not, the shortlist shows only the missing calls with prices.
- Cache keys should be `(vendor, endpoint, canonical entity id, normalized args)` with a vendor-specific freshness TTL. Headcount can be monthly. News should be days. The Q3 entity pin is what makes cache hits reliable across jobs.
- Agento already has a "Shared knowledge layer" (task #19) and "Run again". The ledger can feed both.

### Gaps
- No public, detailed design for cross-session research caches from OpenAI, Google or Anthropic was found.
- Data-licensing limits on caching or reselling bought vendor data (Coresignal, PredictLeads terms) were not researched and need checking.

---

## Q8. Evaluation: how such systems measure usefulness

### Takeaway
The field uses **LLM-as-judge with rubrics** (Anthropic: a single prompt, 0–1 score plus pass/fail), **reference-based report scoring** (RACE: comprehensiveness, insight, instruction-following, readability) and **citation verification** (FACT: statement–URL support checks). Start with about 20 representative queries, and keep humans in the loop for source-quality failures.

### Cited Findings
- Anthropic: start with about 20 representative queries, since small samples reveal large effects. The LLM judge rubric covers factual accuracy, citation accuracy, completeness, source quality and tool efficiency. A single LLM call returning a 0.0–1.0 score and pass/fail matched human judgment best. Human testers caught agents preferring SEO content farms over authoritative sources. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- DeepResearch Bench RACE scores comprehensiveness, insight, instruction-following and readability against expert reference reports. FACT extracts statement–URL pairs, retrieves the cited page and checks support, yielding **citation accuracy** and **effective citations per task**. Perplexity Deep Research had the highest citation accuracy at 90.24%. Gemini-2.5-Pro and OpenAI Deep Research showed a notable gap below it. — [DeepResearch Bench](https://deepresearch-bench.github.io); [arXiv 2506.11763](https://arxiv.org/pdf/2506.11763) (snippets)
- Judge models differ across runs (Gemini-2.5-Pro, Gemini-2.5-Flash, GPT-class), so scores aren't directly comparable across reproductions. — [deep_research_bench repo (via search)](https://github.com/Ayanami0730/deep_research_bench)
- "How Far Are We from Genuinely Useful Deep Research Agents?" (arXiv 2512.01948) directly targets usefulness. — [arXiv 2512.01948](https://arxiv.org/pdf/2512.01948) (title only; not read)

### Inferences
- **Agento rubric proposal** (judge per job, 0–1 each):
  1. every decision question answered or explicitly "not found";
  2. every claim cites a fact_id that supports it (a FACT-style check, cheap because facts are already structured);
  3. right entity (pin confirmed);
  4. insight, meaning there is at least one so-what or cross-source finding not present in any single vendor response;
  5. spend efficiency, meaning $ per answered question and the share of calls that changed an answer.
- Criterion 5 is the paid-data analogue of Anthropic's "tool efficiency" and directly measures "bought data turned useful".
- A held-out set of about 20 real company checks, run before and after adding the think step, is enough to see the effect, per Anthropic's experience.

### Gaps
- No public benchmark specifically scores "decision-relevance" for paid-data enrichment reports. RACE's insight dimension and Anthropic's completeness are proxies.
- Perplexity's and Exa Research's internal evaluation methods weren't found.
