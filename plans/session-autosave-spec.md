# Sessions: autosave, checkpoints and a per-device open session

Engineering spec behind plan v2.5 (`plans/sessions-and-groups.html`). It replaces the
"versions" part of the sessions library built in phase 4. Everything else in the plan
(groups, stash, smart grouping, the move-in from the old stores) stays as built.

All paths are under `apps/extension/`. The library code is `src/lib/library/`.

## Why

Reproduced in `scratch/review-sessions/model.test.ts` (gitignored; run with
`cd apps/extension && pnpm exec vitest run --config ../../scratch/review-sessions/vitest.config.mjs`):

1. The open session is saved only when you switch away or click "Save version". Nothing
   in `background.js` captures tabs. If Chrome comes back without its windows, the next
   switch saves the empty window as the session's newest version, and tabs opened since
   the last save are in no version.
2. Every edit appends a version (`moveTabs`, edits to a closed session, emptying Home in
   `saveOpenAs`), so ordinary edits use up the 10 kept versions.
3. Which session is open was stored twice (`sessions.status = 'open'` and the
   `openSessionId` value), both in the index that will sync. Fixed in step 1.

## Words

- **Index**: the TinyBase MergeableStore saved under `library:index`. Small. It is what
  sync will carry.
- **Content**: one session's windows, groups and tabs (today's `VersionData`). Stored as
  one entry per save under `library:version:<id>`. An entry never changes once written.
- **Checkpoint**: an index row that owns an older content entry, so the session can go
  back to it. Replaces "version". A checkpoint's row id is its entry's id.
- **Open session**: the session this browser's windows belong to. One per device.
- **Linked**: the open windows really are the open session's tabs, so autosave may write
  them. **Unlinked**: they are not (Chrome came back without them), so nothing is saved
  into the session until the person or Chrome resolves it.

## Target model

### Index (will sync)

`sessions`: `name`, `description`, `color`, `kind` (`home` | `normal`), `archivedAt`
(0 when not archived), `createdAt`, `updatedAt`, `lastOpenedAt`, `contentId` ('' when the
session has no content yet), `tabCount`, `preview`, `origin`, `originId`.

`checkpoints`: `sessionId`, `createdAt`, `reason`, `tabCount`, `windowCount`, `groupCount`.

`stashed`: unchanged.

Values: `schemaVersion`, `migratedAt`.

`open`, `closed` and `archived` are a derived status: open when the id is this device's
open session, archived when `archivedAt > 0`, otherwise closed (step 1, built).

### Content entries

Same shape and same storage keys as today. Every entry has exactly one owner: a
session's `contentId`, a checkpoint row, or a stashed-group row. Entries are never
shared between owners, so an owner going away is the only reason to delete its entry.

### Device state (never syncs)

`chrome.storage.local['library:device']`: `{ openSessionId }` (step 1, built in
`state.ts`).

### Runtime state (per browser run)

`chrome.storage.session['library:runtime']`: `{ link, linkAt }`, where `link` is
`unknown` | `linked` | `unlinked`. Chrome clears it on browser restart and on extension
reload, which is what it needs. Pages read it to show the unlinked banner.

## Rules

### One writer

The background worker is the only context that writes the library: the index, content
entries, device state and runtime state. It runs one write at a time, an action or an
autosave tick, never two interleaved.

Pages keep their own copy of the index for reading and ask the worker to act
(`chrome.runtime.sendMessage`). The worker saves the index before it replies, and the
page merges the stored index before the call resolves, so a page never acts on older
data than the reply describes.

This is why autosave is safe: with every write in one context, in one queue, nothing
can interleave with it. The fake Chrome is one context too, so the tests exercise the
real situation.

The move-in and backup import read the old stores, which only a page can reach. The page
reads and plans; the worker applies the result.

### Writing content

One function writes a session's content: `setContent(lib, sessionId, data, mode)`.

1. If `data` equals the current content, do nothing.
2. Decide whether the content being replaced becomes a checkpoint:
   - `routine` (autosave, saving the session you leave, tabs moved in): when the
     session's newest checkpoint is older than 1 hour, or it has none.
   - `careful` (an edit to a closed session; an autosave that loses more than half of the
     saved tabs): unless a checkpoint was made in the last 5 minutes.
   - `always` (before a restore, before "Keep what's open", the first save after the
     upgrade).
   - `never` (emptying Home after its tabs became a named session).
   Empty content never becomes a checkpoint.
3. Write the new entry, then point `contentId` at it and update `tabCount`, `preview` and
   `updatedAt` in one transaction. The entry is written before the index refers to it.
4. The replaced entry either becomes the checkpoint's (a row with that id, created only
   if the entry exists) or is deleted.
5. Keep the newest 10 checkpoints per session; delete the rest with their entries.

A manual checkpoint writes its own copy of the current content. Restoring a checkpoint
calls `setContent` with the checkpoint's data and mode `always`; the checkpoint stays.
For the open session, restoring also reopens that state in the browser, with the same
mechanics as a switch.

### Autosave

`src/lib/library/autosave.ts` holds the logic (framework-free, tested with the fake
Chrome); `background.js` only registers listeners, at the top level, as Manifest V3
requires.

- Triggers: tabs created, removed, moved, attached, detached, replaced; a tab's `url`,
  `groupId` or `pinned` changing; tab groups created, updated, moved, removed; windows
  created or removed. These save after 2 seconds of quiet, at most 10 seconds after the
  first event. A tab's `title` or `favIconUrl` changing saves after 15 seconds of quiet.
  Every wait stays well under 30 seconds, when Chrome may stop an idle worker.
- A tick is a write like any other: it waits its turn and never runs during an action.
- A tick does nothing while the library has not been moved in (`migratedAt` is 0).
- With no open session, Home is the open session, as today.
- With no normal window open, nothing is saved and `link` becomes `unknown`.
- When `link` is not `linked`, the tick first decides it: linked when the saved content
  has no real tabs, or when at least half of the saved real tabs' addresses are open
  (counting duplicates). Otherwise `unlinked`, and the tick saves nothing. A real tab is
  one whose address is not empty, `chrome://newtab/` or `about:blank`.
- When linked, the tick captures what is open and calls `setContent` with `careful` if
  more than half of the saved real tabs are gone, otherwise `routine`.
- The content written is exactly the capture. Autosave never merges with the saved
  content.

### Unlinked

While unlinked, every tick re-checks, so Chrome restoring its windows late (or the person
reopening a closed window) links again by itself. Two actions resolve it by hand:

- **Reopen its tabs**: opens the saved content next to what is open, closes nothing, and
  sets `linked`.
- **Keep what's open**: writes the capture as the content with mode `always`, and sets
  `linked`.

Switching to another session while unlinked does not save into the session being left.
If real tabs are open, they are saved first as a new closed session named from their
sites, so the switch closes nothing that isn't saved. A switch ends by setting `linked`.

### Stashed groups

They stay in their own table and entries, and are not folded into a session's content.
A session's content is exactly what is open, which is what lets autosave write the
capture without reading what was there.

### What changes which session is open

Only a live action (`switchTo`, `saveOpenAs`, `putAway`, deleting or archiving the open
session) and the one-time move-in. Importing or merging a backup never does. After an
import, if the open session no longer exists, the device has no open session (Home).

## Upgrading stored data

The library is live on a real browser profile with years of sessions. Treat it that way.

- `src/lib/library/upgrade.ts` runs when the library opens. It is a chain keyed by the
  `schemaVersion` value: 1 → 2 (step 1, built), 2 → 3 (step 3). Each link is idempotent
  and deterministic.
- The stored index is read before persistence starts, because loading rewrites it. That
  untouched index is copied to `library:index:v1` before the first change, only if the
  key is absent.
- If the upgrade fails, the library does not open: `getLibrary()` rejects and the next
  call tries again. New code never runs on an index it could not upgrade.
- TinyBase drops tables, cells and values that are not in the schema when it loads
  content, and deleting a cell that has a default only resets it. So old names stay
  declared, without defaults, until the upgrade has moved them out. A test loads an old
  index the way the extension does and proves nothing is lost.
- 2 → 3: `contentId` takes `headVersionId`. The head version's row is dropped, since its
  entry is now the session's content. Every other `versions` row becomes a `checkpoints`
  row with the same id. Old reasons (`switch`, `manual`, `restore`, `edit`, `park`,
  `migrated`, `close`) stay valid.
- The first autosave tick after 2 → 3 treats the open session as linked once and saves
  with mode `always`: under schema 2 the open windows are the session by definition, and
  its last saved state becomes a checkpoint.
- `planMigration` (the move-in from the old stores, and old-format backups) keeps
  producing its current result. Applying it writes that result and then runs the chain.
- Library backups written before this change import through the same chain.

## Steps

1. **Per-device open session.** Built: `b3a62c6`.
2. **The worker is the only writer.** Every library write moves behind messages to the
   worker, which runs them one at a time. No change in behavior.
3. **Content, checkpoints and autosave.** The content types are renamed first
   (`VersionData` → `SessionContent`, `VersionTab` → `SavedTab`, `VersionGroup` →
   `SavedGroup`, `VersionWindow` → `SavedWindow`) as a separate, behavior-free commit.
   Then `setContent`, checkpoints, upgrade 2 → 3, runtime state, autosave and the
   reworked actions. Screens change only as far as needed to compile and keep working.
4. **Screens.** Save version buttons removed; saved status; History in place of
   Versions; edits to a closed session apply at once with Undo; the unlinked banner and
   its two actions; "Save a checkpoint" kept as a palette command; wording everywhere.
5. **Real-browser check.** The built extension in a throwaway Chrome profile.

## Left for the sync plan (5b)

- Home's id becomes per device when sync is switched on. It is a local change at that
  moment; no server copy exists before then.
- Only one device autosaves a session at a time (the row records which device has it
  open); a losing save is kept as a checkpoint.
- Own ids for saved tabs and groups. Content entries are immutable and read through one
  function, so adding ids later needs no migration; their shape should follow what the
  agent tools need.
- Syncing content entries (upload on write, download on first read).
- The synchronizer itself runs in the worker, next to the only writer.
