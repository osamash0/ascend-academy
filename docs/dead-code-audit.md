## Dead Code Audit Goal

To audit the project for unused code before deployment or a major refactor, run the goal
defined in `.claude/dead-code-audit.md`.

Scope:
- Unused React components, hooks, utils, context, styles, assets, routes
- Unused FastAPI endpoints, functions, classes, Pydantic models, .py files
- Unused npm and pip dependencies
- Unused env vars, config keys, docker-compose entries

The audit is **report-only** — Claude Code must never delete or modify anything.
To trigger: paste `.claude/dead-code-audit.md` as a `/goal` in Claude Code.