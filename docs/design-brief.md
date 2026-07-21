# Design brief — Inbox Concierge UI pass

For the dedicated design session. The app is structurally complete and
deliberately unstyled (default shadcn). This pass owns visual identity;
it does not own logic or component boundaries.

## Context

A take-home demoed in a screen-recorded video. The UI must read instantly on
camera at 1080p: an email app that sorts itself, visibly, live. Tone:
calm, credible email client — not a flashy dashboard.

## Hero moments (must be visually prominent — these carry the demo)

1. **Live sorting**: threads land in buckets progressively as SSE batches
   resolve. The progressive feel should be felt — count ticks, subtle row
   arrival — without gimmicks.
2. **Consistency auto-review**: "N threads auto-reviewed, M corrected" after
   classification. Currently a small text indicator; deserves real presence.
3. **Custom bucket creation results**: "Scanned 200 · evaluated 34 · moved
   12" — this sentence is the architecture thesis made visible. Make it land.

Supporting beats (present, shouldn't dominate): correction toast ("future
sorting will learn from this"), bucket suggestions, remote-images-blocked
notice in the read view.

## Surfaces to design

- **Login page** (`src/app/page.tsx`): full redesign latitude. Product name,
  one-paragraph pitch, privacy line, Google sign-in. First thing reviewers see.
- **Inbox** (`inbox-app.tsx`): header (title, account, Settings entry),
  bucket tabs with counts, thread list.
- **Thread rows** (`thread-row.tsx`): sender, subject+snippet, date, bucket
  badge (in All view), low-confidence badge, reason tooltip, "sorting…" state.
- **Read dialog** (`thread-view-dialog.tsx`): message stack (latest open,
  older collapsed), bucket re-file select, remote-images notice, sandboxed
  iframe body (iframe content itself is out of scope).
- **Settings** (`settings-dialog.tsx`): bucket management (edit criteria /
  delete), mail actions, account actions. Currently a modal — free to
  re-present (menu, sheet, page) as long as the callbacks stay.
- **Dialogs**: create/edit bucket (+ its results state), suggestions list,
  three confirms (re-sort, delete bucket, delete data).
- **States**: loading skeletons, empty buckets, load error + retry, session
  expired. All exist; style them.
- Explicitly out of scope: `/label` (developer instrumentation, stays plain).

## Fixed (do not change)

- Component boundaries, props, callbacks, and all logic/handlers.
- Every state that exists must remain reachable.
- Styling stays as Tailwind classes on components (theming via
  `globals.css` tokens is fine); no scattered CSS files, no new UI runtime
  dependencies.
- Accessibility: keyboard reachability and labels survive the redesign.

## Free

- Visual identity: type, color, spacing, density, dark mode if it earns it.
- Layout: single column vs. split, tab treatment, where progress lives.
- Re-presenting the settings surface and the confidence/reason display.
- Motion, as long as it serves the live-sorting story and stays subtle.

## Sequencing note

Redesign against a running app (`npm run dev`, real account). Verify the
three hero moments on a fresh sign-in (delete data → sign in → watch the
full classify run) before calling it done.
