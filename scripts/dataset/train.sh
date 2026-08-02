#!/bin/sh
# LOCAL LoRA TRAINING LOOP — weights that actually change, on hardware Ramon owns.
#
# Ramon, 2026-08-01: "build the training loop."
#
#   ./scripts/dataset/train.sh setup    one-time: venv + mlx-lm (Apple-silicon native)
#   ./scripts/dataset/train.sh check    is the data sufficient to learn anything? (honest answer)
#   ./scripts/dataset/train.sh train    LoRA fine-tune, then score against the held-out set
#
# ── WHAT THIS MACHINE CAN DO, measured not assumed ───────────────────────────────────────────
# Apple M2, 8 GB UNIFIED memory. The OS and apps take 3-4 GB, leaving ~4-5 GB for a model plus
# optimizer state. That is the binding constraint and it is not negotiable by config:
#
#   1B  4-bit  ~0.8 GB weights   LoRA fits comfortably          <- what runs here
#   3B  4-bit  ~2.0 GB weights   LoRA fits, slower              <- upper bound on 8 GB
#   7B  4-bit  ~4.0 GB weights   swaps and thrashes on 8 GB     <- needs 16 GB+
#  14B  4-bit  ~8.0 GB weights   impossible here                <- needs 32 GB+
#
# If the goal is a model that genuinely rivals a hosted one at underwriting, the hardware answer
# is 32-64 GB of unified memory, not a different flag in this script.
#
# ── AND THE HARDER TRUTH: TODAY'S DATA WILL NOT SUPPORT IT ───────────────────────────────────
# `check` exists because a trainer that happily runs on 8 positive examples and prints a number
# is the same lie as a heartbeat logged before the work. It refuses instead.
set -e
cd "$(dirname "$0")/../.."
VENV=".venv-mlx"
BASE="${FETTI_BASE_MODEL:-mlx-community/Qwen2.5-1.5B-Instruct-4bit}"
ADAPTER="dataset/adapters"

case "${1:-}" in
  setup)
    echo "Creating an ISOLATED venv — the system Python is 3.9.6 and must not be touched."
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip
    echo "Installing mlx-lm (Apple-silicon native; no CUDA, no cloud)..."
    "$VENV/bin/pip" install --quiet "mlx-lm>=0.18" || {
      echo "FAILED. mlx-lm wants Python 3.9+; you have $(python3 --version)."
      echo "If it refuses, install a newer Python (brew install python@3.12) and re-run."
      exit 1; }
    echo "OK. Base model on first train: $BASE (~1 GB download)"
    ;;

  check)
    # THE GATE. Minority-class count is what decides whether a classifier can be learned at all;
    # total row count is a vanity number. A rule of thumb that has not failed: you want ~100+
    # examples of the RARE class before a fine-tune can beat a heuristic, and enough in the
    # held-out set that one flip does not swing the score.
    npx tsx scripts/dataset/evaluate.ts | sed 's/^/  /'
    POS=$(grep -c 'EARNED A REPLY' dataset/comms.train.jsonl 2>/dev/null || echo 0)
    EVALPOS=$(grep -c 'EARNED A REPLY' dataset/comms.eval.jsonl 2>/dev/null || echo 0)
    echo ""
    echo "  minority-class examples: $POS in train, $EVALPOS in held-out"
    if [ "$POS" -lt 100 ] || [ "$EVALPOS" -lt 30 ]; then
      echo ""
      echo "  NOT ENOUGH TO TRAIN — and running anyway would produce a number that means nothing."
      echo "  With $EVALPOS positives held out, ONE prediction flipping moves F1 by roughly"
      echo "  $(awk -v p="$EVALPOS" 'BEGIN{ if (p>0) printf "%.0f", 100/p; else print "inf" }') points. That is noise, not measurement."
      echo ""
      echo "  What actually unlocks it: ~100 replied-to messages in train and ~30 held out."
      echo "  At the current 6.4% reply rate that is roughly 1,500-2,000 more outbound messages"
      echo "  WITH their replies — i.e. months of real conversation, not a bigger scrape."
      echo ""
      echo "  Until then the same 25 underwriting overrides are worth more as few-shot exemplars"
      echo "  inside the existing prompts than as training rows. Same data, useful today."
      exit 2
    fi
    echo "  Sufficient. ./scripts/dataset/train.sh train"
    ;;

  train)
    [ -d "$VENV" ] || { echo "Run: ./scripts/dataset/train.sh setup"; exit 1; }
    "$0" check || { echo ""; echo "Refusing to train on insufficient data."; exit 2; }
    echo "LoRA fine-tune: $BASE"
    # Small rank + few layers: on 8 GB the memory ceiling, not the data, decides these.
    "$VENV/bin/python" -m mlx_lm lora \
      --model "$BASE" \
      --train \
      --data dataset \
      --adapter-path "$ADAPTER" \
      --batch-size 1 \
      --num-layers 8 \
      --iters 400 \
      --learning-rate 1e-5 \
      --steps-per-eval 100
    echo ""
    echo "Adapter written to $ADAPTER. Scoring against the HELD-OUT set it never saw:"
    npx tsx scripts/dataset/evaluate.ts --model "$ADAPTER"
    ;;

  *)
    echo "usage: ./scripts/dataset/train.sh [setup|check|train]"
    exit 2
    ;;
esac
