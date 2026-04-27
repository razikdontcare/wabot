---
trigger: always_on
---

═══════════════════════════════════════════════════════
MANDATORY SESSION INITIALIZATION — DO THIS BEFORE ANYTHING ELSE
═══════════════════════════════════════════════════════

1. READ SYSTEM_MAP.md at the repo root.

2. From the map, internalize:
   a. Architecture pattern and layer responsibilities
   b. Directory Map — so you know where to look for any type of file
   c. File Registry — your index; use this instead of listing directories
   d. Key Abstractions — the symbols everything else depends on
   e. Conventions & Gotchas — the rules you must follow
   f. Data Flow Map — so you can trace any request path without reading every file

3. CONFIRM READINESS by stating:
   "System map loaded. Project: [name]. Architecture: [pattern].
    I will use the map as my primary index and update it after any changes."

4. DO NOT re-scan directories that are already indexed in the map.
   - ONLY read a file from disk if:
     (a) The map says it exists and you need its current content for the task, OR
     (b) You believe the map is stale for a specific file (state your reason), OR
     (c) You are creating a new file (then you must add it to the map afterward)

5. IF THE MAP IS MISSING OR CORRUPT:
   Stop. Tell the user: "SYSTEM_MAP.md is missing or unreadable. Run the
   'Generate System Map' prompt before continuing."
   Do not proceed without the map.

═══════════════════════════════════════════════════════
MANDATORY MAP UPDATE — DO THIS AFTER COMPLETING YOUR TASK
═══════════════════════════════════════════════════════

After finishing your work, update SYSTEM_MAP.md to reflect every change you made.
Apply only the relevant updates from this checklist:

[ ] FILE REGISTRY — For each file you created, add a new row with path, purpose,
    exports, imports, and tags. For each file you deleted, mark its row [DELETED YYYY-MM-DD].
    For each file you significantly modified, update its exports/purpose row.

[ ] KEY ABSTRACTIONS — If you added or changed a symbol that other modules depend on,
    update its entry. If you added a new central abstraction, add a row.

[ ] DATA MODELS — If you added fields, changed types, or added a new model, update the
    interface definition in the Data Models section.

[ ] API SURFACE — If you added, changed, or removed an HTTP endpoint, update the table.

[ ] DEPENDENCIES — If you installed a new package, add it to the Dependencies table
    with version, purpose, and where it's used.

[ ] ENVIRONMENT VARIABLES — If you added a new env var, add it to the table with its
    type, whether it's required, its default, and where it's used.

[ ] CONVENTIONS & GOTCHAS — If you discovered something non-obvious during this task
    that future agents should know, add a row.

[ ] DATA FLOW MAP — If middleware order changed, a new layer was introduced, or the
    error handling path changed, update the flow diagram.

[ ] META — Update `last_updated` to today's date and `last_updated_by` to your session ID.

[ ] CHANGELOG — Append one line: date, version bump (patch for small changes, minor for
    new features, major for architecture changes), changed-by, and a one-sentence summary.

IMPORTANT:
- Edit only the rows/sections that changed. Do not rewrite unchanged sections.
- Never remove rows — mark deletions with [DELETED].
- If you are uncertain whether something changed, err on the side of updating.
- The map is the source of truth. If your changes aren't in the map, they are invisible
  to future agents.