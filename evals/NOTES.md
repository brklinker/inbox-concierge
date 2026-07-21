# Eval notes

Terse, dated, decision-shaped. One entry per prompt version. Results files in
`results/` are the raw output of `npm run eval` for each version.

## 2026-07-21 — v1 (baseline)

Initial prompt: bucket list with descriptions, decision rules (sender
relationship dominates, list-mail heuristics, urgency cues), asymmetric error
costs stated explicitly (prefer higher-attention bucket when uncertain;
Auto-Archive only at high confidence), temperature 0, structured outputs with
the bucket enum enforced in-schema.

Gold set and first accuracy number pending: label ~50 threads at `/label`
**before** reading model output, then run `npm run eval`.
