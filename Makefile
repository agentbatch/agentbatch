.PHONY: all install build build-contracts build-ts test test-contracts test-ts fmt fmt-check lint clean

all: install fmt-check build lint test

install:
	pnpm install --frozen-lockfile

build: build-contracts build-ts

# The exact artifact deployed to Testnet (hash recorded in deployments/testnet/manifest.json).
build-contracts:
	stellar contract build --optimize

build-ts:
	pnpm build

test: test-contracts test-ts

# The WASM tests load the compiled contract, so it is rebuilt first.
test-contracts: build-contracts
	cargo test --locked --workspace

test-ts:
	pnpm --filter @agentbatch/voucher build
	pnpm test

fmt:
	cargo fmt --all

fmt-check:
	cargo fmt --all --check

# The demo typechecks against @agentbatch/voucher's build output.
lint:
	cargo clippy --locked --workspace --all-targets -- -D warnings
	pnpm --filter @agentbatch/voucher build
	pnpm typecheck

clean:
	cargo clean
	rm -rf packages/*/dist apps/*/dist
