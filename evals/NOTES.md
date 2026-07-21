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
