# Eval notes

Terse, dated, decision-shaped. One entry per prompt version. Results files in
`results/` are the raw output of `npm run eval` for each version.

## What the number means (methodology)

The gold set is one person's judgment of their own mail, so accuracy here
means "agreement with the mailbox owner" — which is the product's actual job;
triage has no objective ground truth. Discipline for prompt iteration: a miss
caused by general reasoning gets a prompt fix; a miss caused by personal
preference gets a bucket-description edit or an in-app correction instead.
Prompt edits chasing one user's idiosyncrasies overfit. The harness groups by
user_email, so any other user who labels their own threads gets their own
number against their own judgment.

## 2026-07-21 — v1 (baseline)

Initial prompt: bucket list with descriptions, decision rules (sender
relationship dominates, list-mail heuristics, urgency cues), asymmetric error
costs stated explicitly (prefer higher-attention bucket when uncertain;
Auto-Archive only at high confidence), temperature 0, structured outputs with
the bucket enum enforced in-schema.

Gold set and first accuracy number pending: label ~50 threads at `/label`
**before** reading model output, then run `npm run eval`.

## 2026-07-21 — v1 baseline: 36.8% raw (57 gold), zero catastrophic misses

The raw number is dominated by two non-model problems, found by reading the
confusion matrix rather than trusting the headline:

1. **Labeling-harness vocabulary gap (9 misses).** /label only offered the
   five default buckets, so recruiter mail got gold-labeled Important; the
   live classifier (correctly) routes it to the user's custom Recruiters
   bucket and was graded wrong for it. Fixed: /label now offers all buckets.
   Affected threads need relabeling before the next run.
2. **Preference divergence, not reasoning failure (~13 misses).** CI spam,
   payment receipts, and sign-in alerts were gold-labeled Auto-Archive, but
   the default Notifications description explicitly claims receipts and
   security alerts, and the asymmetric-cost rule biases away from
   Auto-Archive by design. Per the methodology note, this is a
   bucket-description fix, not a prompt fix — which exposed that default
   descriptions weren't editable. Now they are ("Edit criteria").
3. Remainder are genuine judgment gaps (family sender treated as Can Wait,
   borderline event promos) — correction-loop material.

What matters most held: zero Important→Auto-Archive, 100% precision on
Important. Next: relabel with full vocabulary, tune Notifications/Auto-Archive
descriptions to taste, re-run as v1 (prompt unchanged) for an honest baseline.

First 200-thread run misfiled a Sequoia networking email into Auto-Archive at
0.8 confidence with the reason "Promotional email from Steam" — the model had
stamped the Steam thread's verdict with the Sequoia thread's id inside a batch
(one id returned twice, one id missing). Too confident for the consistency
pass to flag; caught by a human hovering the reason tooltip. Guard added in
code: results with duplicated ids are all dropped and those threads resent,
since a duplicate id is the fingerprint of the swap. Lesson recorded for the
write-up: batch classification's cheapness comes with id-integrity risk, and
self-reported confidence says nothing about it.

## 2026-07-22 — v1 re-run, gold set 57→95: 47.4% raw, 1 catastrophic

Prompt unchanged; the gold set grew and the Can Wait bucket was deleted.
Reading the misses, ~40 of 50 are label/description coherence, not reasoning:

1. **Stale gold labels (5).** Can Wait was deleted but 5 golds still say it —
   the classifier can never predict a deleted bucket. Relabel at /label.
2. **Recruiters boundary undefined (12, both directions).** Model draws
   cold-outreach→Recruiters, active-process→Important. Gold currently draws
   it the other way twice over: 6 cold-outreach threads still carry
   vocabulary-gap-era Important labels, while newly labeled interview
   logistics went to Recruiters. Decide the line, write it into the
   Recruiters description, make the golds match.
3. **Notifications description contradicts the labels both ways (~22).**
   Golds put receipts/sign-ins/CI in Auto-Archive but the default
   description explicitly claims receipts and security alerts (11 misses);
   golds put human calendar invites, travel bookings, and account-security
   changes in Important but the description claims invites too (6); building
   notices gold-Notifications got scattered (5). Description surgery, not
   prompt surgery.
4. **Newsletter over-applied: 14% precision.** Model stretches "subscribed
   periodic content" to cover marketing blasts and event promos. Tighten the
   description to deliberately-subscribed editorial only.

First catastrophic miss: LinkedIn "your data archive is ready" (gold
Important — a requested export; model saw automated bulk mail). Borderline
single case: correction-loop material, not worth a description clause.

Next: fix 1–4 (labels + descriptions, prompt stays v1), re-run for the
honest baseline before any v2 prompt work.

## 2026-07-22 — v1 coherence pass: 47.4% → 80.0%, catastrophic back to 1

Prompt unchanged. Everything below is labels and descriptions — the fix
categories the previous entry prescribed, executed per explicitly declared
preference policies (recorded here so the relabels are auditable):

1. **Recruiters line declared**: cold outreach → Recruiters; active
   process (scheduled screens, take-homes, replied intro calls) →
   Important. 12 gold flips both directions. Recruiters also got its
   first description — it had none, which explains most of its old chaos.
2. **Stale Can Wait golds (5)** relabeled nearest-fit per thread.
3. **"GitHub Notifications" test bucket deleted**; its 5 threads released.
4. **Description surgery** on Important/Notifications/Auto-Archive/
   Newsletter in three passes: 66.3% → 82.1% → 80.0%. Pass 2's receipt
   fix exposed that a clause meant for Vercel deploy failures was pulling
   work CI into Important (CI arrives sender-named as the user); pass 3
   separated them and traded 2 points of accuracy for halving catastrophic
   misses (2 → 1) — the right trade by this product's own cost model.

Results per bucket: Recruiters 92.9/92.9, Important 84.0/95.5 — the two
buckets that matter most now behave.

Honest caveats, so the number is read correctly: descriptions were tuned
against this gold set — the true test is the next 200 fresh threads, and
further iteration against these 95 is overfitting, so v1 tuning stops
here. Several residual misses are duplicate-content threads carrying
opposite gold labels (two "E2E Tests" CI threads, two Amex payment
receipts) — the metric's ceiling is the labeler's own consistency. The
one remaining catastrophic (LinkedIn "data archive ready", a requested
export the model reads as bulk mail) resists an explicit description
clause: correction-loop material, and a good demo of why corrections
exist.
