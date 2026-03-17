# AGENTS.md

Repository guidance for coding agents working in `opencode-webhook-notify`.

## 1) Project Snapshot
- Runtime: Bun + TypeScript (ESM).
- Entrypoint and main implementation: `src/index.ts`.
- Utility script: `scripts/update-version.ts`.
- Package exposes TS sources directly (`main`/`module` -> `src/index.ts`).
- Type discipline comes from `tsconfig.json` strict settings.
- Current repo is intentionally minimal: no dedicated lint/test stack yet.

## 2) Source-of-Truth Files
- `package.json`: scripts, module mode, dependencies.
- `tsconfig.json`: strictness and module semantics.
- `README.md`: setup + runtime configuration examples.
- `src/index.ts`: coding patterns and runtime behavior.
- `scripts/update-version.ts`: scripting pattern for Bun CLI tasks.

## 2.1) Mandatory OpenCode Docs (Read Before Work)
Before implementing changes in this repository, agents must read these docs first:
- `https://opencode.ai/docs/zh-cn/sdk/`
- `https://opencode.ai/docs/zh-cn/server/`
- `https://opencode.ai/docs/zh-cn/plugins/`

If repository code and docs differ, prefer repository reality and record the mismatch in your final notes.

## 3) Build / Lint / Test Commands

### Install
- `bun install`
- `npm install` (fallback)

### Typecheck (primary quality gate)
- `bun run typecheck`
- `npm run typecheck`
- Script definition: `tsc --noEmit` (`package.json`).

### Build
- No build command is currently defined.
- This package is source-first and consumed as plugin code.

### Lint
- No linter command/config is currently defined.
- Do not invent lint rules in task work unless explicitly requested.

### Test
- No test command/framework is currently configured.
- No `*.test.*` files are present at the time of writing.

### Single-Test Execution
- Not available in current repo state (no test framework configured).
- If tests are introduced, update this section immediately.
- Likely future Bun examples (informational only, not active now):
  - `bun test path/to/file.test.ts`
  - `bun test -t "case name"`

## 4) Versioning / Publish Hooks
- `bun run update-version`
  - Runs `scripts/update-version.ts`.
  - Uses `git describe --tags --always --dirty` to derive version.
- `prepublishOnly` executes `bun run update-version`.

## 5) Minimum Verification Before PR
Given current tooling, minimum validation is:
1. `bun run typecheck`
2. Confirm changed docs/examples reflect actual behavior.
3. If runtime logic changed, do a targeted manual sanity check.

If lint/tests are added later, extend this checklist.

## 6) Code Style Guidelines
These reflect repository conventions plus TS-enforced constraints.

### Imports and Modules
- Use ESM imports/exports (`"type": "module"`).
- Use `import type` for type-only imports (`verbatimModuleSyntax: true`).
- Keep imports at top of file.
- Prefer explicit imports over wildcard imports.

### TypeScript Strictness
- Keep `strict` compliance; do not weaken compiler settings.
- Respect `noUncheckedIndexedAccess`; handle possible `undefined`.
- Respect `noFallthroughCasesInSwitch`.
- Respect `noImplicitOverride` in class hierarchies.
- Keep `verbatimModuleSyntax` compatible import/export usage.

### Types and Interfaces
- Prefer `interface` for object-shaped contracts.
- Use unions for finite domain states (for example notification kinds).
- Prefer `unknown` over `any` for external/untyped inputs.
- Narrow unknown values with type guards (for example `isRecord`).
- Add explicit return types for public/non-trivial helpers.

### Naming Conventions
- PascalCase: interfaces/types.
- camelCase: functions, variables, params.
- UPPER_SNAKE_CASE: module constants.
- Use descriptive boolean names (`enabled`, `hasX`, `isX`).

### Error Handling
- Use guard clauses for invalid preconditions.
- Use `try/catch` with deterministic fallback for recoverable failures.
- Log boundary-layer failures with actionable context.
- Avoid silent catches unless fallback behavior is intentional.
- Never swallow an error without an explicit fallback outcome.

### Data and Runtime Safety
- Validate external payloads before nested field access.
- Normalize config data near input boundaries.
- Keep template/token render helpers pure when possible.
- Use small helper functions for extraction/parsing logic.

### Formatting and Structure
- Match existing repository formatting in touched files.
- Keep multiline literals readable and consistent.
- Use concise, composable helpers over deep nesting.
- Add comments only when logic is non-obvious.

## 7) File Layout Pattern
For feature files similar to `src/index.ts`, prefer:
1. Imports
2. Constants
3. Type/interface declarations
4. Main export
5. Internal helpers grouped by concern

Keep related helpers physically close.

## 8) Agent Working Rules (Repo-Specific)
- Make minimal, surgical edits.
- Preserve Bun + TypeScript patterns already present.
- Do not add dependencies unless task requires them.
- Do not introduce lint/test/formatter stacks without user request.
- Update `README.md` and this file when commands or behavior change.

## 9) Current Gaps / Debt (Context)
- No automated lint pipeline.
- No automated test suite.
- Core logic concentrated in `src/index.ts` (large single module).

These are context notes, not blanket refactor instructions.

## 10) Cursor and Copilot Rule Files
Checked and not present in this repository:
- `.cursor/rules/`
- `.cursorrules`
- `.github/copilot-instructions.md`

If these files are added later, merge their guidance into this doc.

## 11) Quick Command Reference
- Install dependencies: `bun install`
- Typecheck: `bun run typecheck`
- Update package version from git describe: `bun run update-version`
- Prepublish hook path: `bun run prepublishOnly`

## 12) Maintenance Rules for This Document
- When adding tests, include full-suite and single-test commands.
- When adding linting, include check-only and autofix commands.
- When changing style conventions, document concrete examples.
- Keep this file exact, current, and implementation-grounded.
