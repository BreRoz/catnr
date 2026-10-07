# Stage 9 — Usability and recovery

**No migration.** Everything here is client behaviour plus one server change (honest AI-outage handling).

## What changed

| Area | Before | Now |
|---|---|---|
| Loading | One full-screen "Your assistant is working…" for everything; a fake 350 ms delay on tab switches; load failures were swallowed silently | Stage-specific inline status (`Uploading your photo and reading your update…`, `Looking through your records…`, `Saving…`, `Undoing…`, `Loading cats…`); after 12 s it says it is still working and that input is safe. No blocking overlay, no fake delay. |
| Failures | Raw server text; an expired Access sign-in (HTML reply) was reported as "connection failed"; AI outage was reported as "could not be committed"; no timeouts | `app/feedback.ts` turns every failure into *what failed / was it saved / what next*. Expired sign-in → "reload to sign in"; dropped connection or timeout on a write → "can't tell if it saved, Try again is safe (same retry key)"; AI outage (`ai_unavailable`, 503) → "nothing saved, try again or use Records". Every list/detail load error has a **Try again** button. Client timeouts 30 s (read) / 70 s (write); the AI call has a 45 s server timeout. |
| Unsaved input | Choosing an example prompt, reopening the sheet or pressing Mic wiped typed text; backdrop tap closed the sheet; Android reloads when the camera opens lost everything | Typed/dictated text and the chosen photo are kept as a draft in `localStorage` (`app/drafts.ts`), saved as Ari types and on close. Home shows "You have an update that isn't saved yet — Continue / Discard". Examples only appear while the box is empty; Mic appends to existing text; the transcript is an editable box. Failed saves never close the sheet or clear input. Forms in Records ask before discarding typed changes (Escape, backdrop, Close, Cancel). If a photo is too big to keep, the words are still kept and Ari is told. |
| Accessibility | Home sheets had no dialog role, Escape, focus trap or focus return; rows were clickable `<article>`s; Escape in Records closed *every* nested sheet; no focus ring | One shared `Sheet` (`app/dialog.tsx`): `role=dialog`, `aria-modal`, labelled by its title, focus trap, Escape closes only the innermost dialog, focus returns to the opener. Rows are real buttons. Global `:focus-visible` ring, `aria-current` on the nav, labelled textareas, status/alert roles on progress and errors, 44 px minimum targets, reduced-motion respected. The dead "Open profile" button is now a non-interactive badge. |
| Mic | Only "not allowed" was distinguished | Plain-language messages for blocked permission, no microphone, network drop (transcript kept), no speech. Unsupported browsers switch to typing with a message. |
| Photos | Duplicate resize code; camera-denied gave no guidance | Shared `resizeToDataUrl`; hint under the buttons about allowing camera access or using the library; unreadable formats (e.g. HEIC on some browsers) explain what to do. |

Code structure: the 29-line `rescue-client.tsx` was split into `capture-sheet.tsx`, `correction-sheet.tsx`, `cat-history-sheet.tsx`, `confirm-card.tsx`, `assistant-client.ts` (fetch + error mapping + retry keys), `feedback.ts`, `drafts.ts`, `dialog.tsx`.

## Offline decision — recommendation: **do not build offline capture now**

*Expected connectivity.* Ari works from a phone on cellular: driving, vet clinics, colony visits. Dead zones exist but are short and intermittent; she usually regains signal within the same trip.

*What offline would actually need.* The product's value is the AI turning speech into validated records. That step needs the server (and a reachable AI provider) and often needs a follow-up question or a yes/no confirmation. Voice dictation itself uses the browser's speech service, which on Android Chrome also needs a connection, so "offline voice" does not exist without shipping our own speech model. An offline *record* can't be validated, can't resolve which cat "the thinner black boy" is, and can't be shown in reports until it syncs. A full offline-first design would also need a service worker that survives Cloudflare Access redirects/expiry, durable storage that iOS may evict, conflict handling against versioned corrections, and a sync queue that never double-applies — a large, bug-prone surface for a single-user tool.

*What this stage already gives her* (the cheap 80%): input is never lost (draft survives a closed sheet, a dropped signal, a reload or a camera round-trip), retries are idempotent, and failures say exactly whether anything saved.

*If field use shows it is needed* (trigger: Ari reports losing or delaying captures because of signal about weekly), build **only an outbox, not offline-first**:
1. "Save for later" stores the raw text + photo (+ timestamp) in IndexedDB, with a visible "Waiting to send (n)" list, each item editable/deletable.
2. Send automatically on the `online` event and on app open, one at a time, reusing the existing retry-key protocol and the normal server validation/clarification flow; the AI interprets at send time. Today's date is taken from the saved timestamp, not send time.
3. No offline reading, no offline edits to records, no local copy of the database.
4. Prerequisites to verify first: Access session lifetime vs. typical offline gaps (a stale token must produce "sign in again", not a silent drop), and iOS storage persistence (`navigator.storage.persist()`).

## Tests

`tests/usability.test.mjs` (22): failure messages for every failure class; mic messages; progress text; draft round-trip, quota fallback, corrupt/unavailable storage, expiry; AI-outage server contract; dialog/focus/row/focus-ring contracts; "failed save never clears input". Existing `rescue-app.test.mjs` now reads the split client files.

Browser checks done in the in-app browser at 375×812 against local dev (`.dev.vars` blanks the Access settings for localhost; git-ignored): type → Escape → draft banner → reload → draft still there → Continue; simulated dropped connection (message, input kept, same retry key on 3 retries), HTML sign-in reply (re-sign-in message), real retry succeeds and clears the draft; dialog label/focus entry, Escape-with-typing asks to discard, nested sheets close one at a time, 40 Tab presses stay inside the dialog, visible focus ring.

## Not verified / remaining risks

- **Not tested on a real phone.** Microphone permission prompts, camera capture, the on-screen keyboard overlapping the sheet, and iOS Safari were not exercised; the emulator can't do them. Manual checklist for Ari's phone: (1) Speak → deny mic → message + Type works; allow → words appear, can edit; (2) turn on airplane mode mid-dictation → transcript kept; (3) Add photo → Take photo → deny camera → hint visible; allow → preview, Save; (4) type an update, switch to the camera app and back (page may reload) → "unsent update" card; (5) airplane mode → Review & record → "not sure if it saved" → turn it off → Try again → saved once; (6) Android back gesture with a sheet open.
- A real AI-provider outage was not exercised (no key locally); the `ai_unavailable` path is covered by source/contract tests, not an end-to-end call.
- `AbortSignal.timeout` needs Safari 16+/Chrome 103+.
- Drafts live in `localStorage` on that device, unencrypted, for up to 7 days (cleared on a successful save). Records-screen forms are guarded against accidental discard but not persisted across a reload.
- Free-text Records forms still use `window.confirm` for the discard prompt (accessible, but unstyled).
- `npm run lint` still reports 45 pre-existing errors in older code (`route.ts`, other tests); none in files touched here. `tsc` baseline errors (missing Workers types) are unchanged.
