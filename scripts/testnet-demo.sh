#!/usr/bin/env bash
# Builds the contract, runs all local tests, then deploys to Stellar Testnet
# and runs the AgentBatch PoC demonstration. Writes:
#   deployments/testnet/manifest.json   deployment identifiers (no secrets)
#   deployments/testnet/evidence.json   every transaction hash, raw XDR, metric and result
#   docs/benchmarks/testnet-resources.json
# Testnet keys are created on first run in .secrets/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
make test
pnpm demo:testnet
