# Skill routing — Vernyr / StudyCRM

Consider these before starting work. Match on what the task *is*, not on what
the prompt literally says; a request to "make the members table nicer" is UI
work whether or not it names a component. Load a skill when it applies — do not
announce the routing, and do not load one that does not fit.

| The task is… | Load |
|---|---|
| Any UI, component, screen, layout, styling, or visual change in `crm/` or `student/` | `apple-hig-designer` — both apps are built on the HIG layer in `globals.css` (iOS type scale, 8pt grid, 44pt targets, concentric radii) |
| New UI where the *look* is still open — aesthetic direction, typography, a page that must not read as templated | `frontend-design`, then `apple-hig-designer` for the system |
| Auditing, polishing or hardening an existing interface — hierarchy, a11y, contrast, motion, empty/error states, responsive behaviour | `impeccable` |
| Any chart, graph, dashboard tile, sparkline or KPI row | `dataviz` — read it *before* writing chart code. `crm/src/components/charts/` is the house wrapper |
| A gradient, hero, OG image or anything on `website/` | `gradient-skin` — the site's ground is generated, not hand-written |
| Backend, Node, Express, route, service, middleware, or any server-side code | `ponytail` — stdlib and existing helpers before new abstractions; this repo has no room for speculative layers |
| Mongoose schema, index, aggregation, slow query, or connection config | `mongodb:mongodb-schema-design`, `mongodb-query-optimizer`, `mongodb-natural-language-querying`, `mongodb-connection` — pick the one that fits |
| Anything calling Claude or another LLM — model ids, pricing, tool use, agents, caching | `claude-api`. Read it before opening the file, never answer from memory |
| Reviewing a diff, branch or PR | `code-review` (or `coderabbit:code-review`) |
| Auth, permissions, row scoping, tokens, uploads, or anything touching `services/access.ts`, `services/scope.ts`, `middleware/auth.ts` | `security-review`, and re-run `npm run test:security` before calling it done |
| "Is this over-engineered", "what can we delete", bloat, boilerplate | `ponytail-review` for a diff, `ponytail-audit` for the repo |
| Running or screenshotting the app to confirm a change | `run` |
| Writing a skill, agent, command, hook or plugin | `plugin-dev:*` — `skill-development`, `agent-development`, `command-development`, `hook-development` |
| Building an MCP server or MCP UI widget | `mcp-server-dev:build-mcp-server`, then `build-mcp-app` / `build-mcpb` |
| settings.json, hooks, permissions, env, "from now on when X" | `update-config` — an automated behaviour needs a hook, not a memory |
| A shareable page, report, doc or interactive tool for someone else to use | `artifact-design` first, then `artifact-capabilities` if it needs state, data or auth |
| Saving session state for a clean handoff | `remember` |

## Standing constraints for this repo

- **Never drive a browser** (Playwright, Chrome MCP) without asking first. Verify UI statically.
- **Do not spawn subagents** unless asked by name.
- Run everything from the repo root — this is an npm workspaces monorepo with one `node_modules`.
- Comments stay minimal; no long explanatory blocks.
- `CLAUDE.md` is the authority on architecture. Read the relevant section before changing a system it describes.
