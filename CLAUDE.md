# Working on Agento

## Design style

- No plain bullet lists or rows of check marks, in the app or in anything made for it (pages, docs, walkthroughs). Show grouped points as proper boxes that fit the styling: cards with a short label and title, tiles, chips, or steps with numbers.
- Every page gets a deliberate look, matching the app: ink outlines, the agent's accent color, the pixel display font used sparingly, offset shadows on the element that matters. Nothing bland or generic.
- Write in plain language from the user's side of the screen.

## Repository

- Commits are made under the owner's GitHub identity, with no co-author or tool attribution lines.
- Never force-push or rewrite published `main`.
- Never commit secrets: `.env.local`, `agento-secrets.env.txt` and `SAVE-THESE-SECRETS/` stay out of git.
- Never spend real mainnet USDC without the owner's go-ahead, and never from tests.
