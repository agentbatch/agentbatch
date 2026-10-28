.PHONY: all install build build-contracts build-ts test test-contracts test-ts fmt fmt-check lint clean

# package.json owns command definitions; Make remains a convenient front door.
all: install
	pnpm build
	pnpm check

install:
	pnpm install --frozen-lockfile

build:
	pnpm build

build-contracts:
	pnpm build:contracts

build-ts:
	pnpm build:ts

test:
	pnpm test

test-contracts:
	pnpm test:contracts

test-ts:
	pnpm test:ts

fmt:
	cargo fmt --all

fmt-check:
	pnpm format:check

lint:
	pnpm lint

clean:
	cargo clean
	rm -rf packages/*/dist tools/*/dist examples/*/dist
