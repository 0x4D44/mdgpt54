# HLD: Configuration & Housekeeping Improvements

**Date:** 2026-03-16
**Status:** Draft
**Priority:** Medium

## 1. Current State

### package.json
- Version 0.7.1, `"type": "module"` (ESM)
- No `engines` field -- Node version requirements are implicit
- Server uses `import.meta.url` and `fileURLToPath` (`server/trafficRelay.ts:288`)
- Server tsconfig targets ES2022 with ESNext modules
- `tsx` (v4.21+) runs the server; `vite` (v7.3+) bundles the client
- Tests use `.at(-1)` (ES2022, Node 16.6+)

### .gitignore
On-disk (uncommitted) `.gitignore` already covers:
```
dist/
node_modules/
tmp/
/.codex-temp-*
/tmp_*
/aircraft_feature_audit*
/audit_fix_validate*
/final_audit_validate*
/stage*.txt
/stage*.patch
/claude_*
```

Committed `.gitignore` only has `dist/`, `node_modules/`, `tmp/`.

### Unignored generated/temporary content
| Path | Type | Files | Notes |
|------|------|-------|-------|
| `coverage/` | vitest coverage output | ~40 | HTML/CSS/JS/XML coverage reports |
| `tmp_audit_probe/` | codex-generated JS | 4 | Already matched by `/tmp_*` |
| `tmp_shutdown_check/` | codex-generated JS | 5 | Already matched by `/tmp_*` |
| `tmp_shutdown_check_runtime/` | codex-generated JS | 5 | Already matched by `/tmp_*` |
| `tmp_solar_check/` | codex-generated JS | 2 | Already matched by `/tmp_*` |
| `tmp_solar_check_esm/` | codex-generated JS | 2 | Already matched by `/tmp_*` |
| `tmp_stage1_test.log` | log file | 1 | Already matched by `/tmp_*` |
| `tmp_tsc.log` | log file | 1 | Already matched by `/tmp_*` |
| `tmp_tsc_es.log` | log file | 1 | Already matched by `/tmp_*` |
| `notes/` | scratchpad/working notes | 2+ | Not ignored, not committed |
| `wrk_docs/` | working documents | 2 | Not ignored, not committed |
| `wrk_journals/` | working journals | 4+ | Not ignored, not committed |

None of the `tmp_*` files are tracked by git (they were never committed). The on-disk `.gitignore` already covers them but that change hasn't been committed yet.

The `coverage/`, `notes/`, `wrk_docs/`, and `wrk_journals/` directories are **not** covered by any gitignore pattern and could be accidentally committed.

## 2. Proposed Changes

### 2a. Add `engines` field to package.json

```json
"engines": {
  "node": ">=18.0.0"
}
```

**Rationale for Node 18 (not higher):**
- `import.meta.url` -- available since Node 12 in ESM modules
- `fileURLToPath` -- available since Node 10
- `.at()` on arrays -- available since Node 16.6
- ES2022 target -- Node 16+ supports the full feature set
- `tsx` 4.x requires Node 18.0+
- `vite` 7.x requires Node 18.0+

Node 18 is the binding constraint (via `tsx` and `vite` dependency requirements). Setting `>=18.0.0` is accurate and gives the earliest compatible version. Node 18 entered EOL 2025-04-30, so in practice users should be on 20+ or 22+, but the engines field documents the hard floor, not a recommendation.

**Placement:** After the `"type"` field, before `"scripts"`.

### 2b. Commit the pending .gitignore additions and add missing patterns

Final `.gitignore` content:

```
dist/
node_modules/
tmp/
coverage/
/.codex-temp-*
/tmp_*
/aircraft_feature_audit*
/audit_fix_validate*
/final_audit_validate*
/stage*.txt
/stage*.patch
/claude_*
/notes/
/wrk_docs/
/wrk_journals/
```

**New patterns added (beyond what's already on disk):**
- `coverage/` -- vitest coverage HTML reports (40 files currently unignored)
- `/notes/` -- working scratchpad (per CLAUDE.md convention, not project source)
- `/wrk_docs/` -- working documents
- `/wrk_journals/` -- working journals

**Not adding:** `*.log` globally -- only `tmp_*.log` files exist and those are already caught by `/tmp_*`. A broad `*.log` pattern could suppress logs people want to see.

### 2c. Delete tmp_* directories from disk (optional, separate step)

The `tmp_*` directories contain only generated JS files from codex audit probes and type-check experiments. They serve no ongoing purpose and total ~30 files. They can be safely deleted after the `.gitignore` is committed. This is a manual cleanup step, not a git operation.

## 3. Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| `engines` field | **Negligible** -- purely advisory. `npm install` warns but doesn't block unless `engine-strict` is set (it isn't). | Verify with `npm install` on current Node (v22). |
| `.gitignore` additions | **Negligible** -- only affects untracked files. No tracked files will be removed. | Run `git status` after to confirm no tracked files are affected. |
| `tmp_*` deletion | **Low** -- generated scratch files with no references. | Review directory contents before deletion (already audited above). |

No build, test, or runtime behavior is affected by any of these changes.

## 4. Verification Plan

1. **After `engines` addition:**
   - `npm install` should complete without errors on Node 22
   - `node -e "const p=require('./package.json'); console.log(p.engines)"` confirms the field is present
   - `npm run check` passes (type-check + tests)

2. **After `.gitignore` update:**
   - `git status` should show only `.gitignore` and `package.json` as modified
   - `git ls-files --others --exclude-standard` should no longer list `coverage/`, `notes/`, `wrk_docs/`, or `wrk_journals/` files
   - Previously tracked files should remain tracked (verify with `git ls-files | head`)

3. **After `tmp_*` cleanup (if done):**
   - `ls tmp_*` should return "No such file or directory"
   - `npm run check` still passes

## 5. Implementation Order

1. Add `engines` to `package.json`
2. Update `.gitignore` with all missing patterns
3. Commit both in a single atomic commit (type: `chore`)
4. Optionally delete `tmp_*` directories from disk
