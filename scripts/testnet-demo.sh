#!/usr/bin/env bash
# Builds the contract, runs all local tests, then deploys to Stellar Testnet
# and runs the AgentBatch PoC demonstration. Writes:
#   deployments/testnet/runs/<run-id>/{manifest,evidence,benchmark,complete}.json
# Each invocation uses fresh keys in .secrets/testnet/ and isolated provider
# state in .state/testnet/. Both directories are gitignored.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
pnpm check
pnpm testnet:demo
