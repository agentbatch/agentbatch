.PHONY: all build build-contracts build-ts test test-contracts test-ts fmt fmt-check lint clean

all: fmt-check lint test build

build: build-contracts build-ts

build-contracts:
	stellar contract build --optimize

build-ts:
	pnpm build

test: test-contracts test-ts

test-contracts: build-contracts
	cargo test --workspace

test-ts:
	pnpm test

fmt:
	cargo fmt --all

fmt-check:
	cargo fmt --all --check

lint:
	cargo clippy --workspace --all-targets -- -D warnings
	pnpm typecheck

clean:
	cargo clean
	rm -rf packages/*/dist apps/*/dist
