# AgentBatch
## Shared Treasury and Batch Settlement Infrastructure for AI-Agent Payments on Stellar

> This is the full product vision. The proof of concept in this repository
> implements only the scope described in §15; everything else is planned work.
> See [`../SCF_POC_EVIDENCE.md`](../SCF_POC_EVIDENCE.md) for what is demonstrated today.

### 1. Project Overview

AgentBatch is open-source payment infrastructure built on Stellar that enables AI agents and organizations to manage high-frequency micropayments across multiple independent service providers using a shared USDC treasury.

Instead of funding and deploying a separate payment channel for every provider, AgentBatch allows an organization to deposit USDC into a shared Soroban contract and allocate collateral to multiple virtual payment channels.

AI agents authorize payments by signing cumulative off-chain vouchers. Service providers verify these vouchers without requiring an on-chain transaction for each API request.

Providers periodically redeem their accumulated payment claims. Multiple independent channels can be settled together through a single Soroban transaction.

AgentBatch combines:

- Shared treasury and collateral management.
- Multiple provider-isolated virtual payment channels.
- Delegated AI-agent spending authority.
- Off-chain signed cumulative micropayments.
- Coordinated, atomic multi-provider settlement.
- Open interfaces for existing AI-payment facilitators.

**Core value proposition: One funded treasury, many independent provider channels, high-frequency off-chain payments, and coordinated on-chain settlement.**

AgentBatch is designed as reusable settlement infrastructure rather than another competing x402 facilitator or AI application.

### 2. Vision

AgentBatch's vision is to make Stellar a scalable settlement infrastructure for autonomous AI commerce.

AI agents increasingly interact with external services, including language models, reasoning engines, search APIs, data providers, computation platforms and other autonomous agents.

Many of these interactions involve small, usage-based payments.

An organization operating several AI agents may need to pay dozens of independent services thousands of times per day.

AgentBatch aims to make this possible without requiring every interaction to become a separate blockchain transaction or requiring a separately funded smart contract for every agent-provider relationship.

The long-term objective is an open settlement coordination layer that AI platforms, wallets, agent frameworks, and Stellar payment facilitators can integrate.

### 3. The Problem

Stellar already supports low-cost payments and off-chain micropayment channels.

Its existing Machine Payments Protocol (MPP) SDK and experimental one-way-channel implementation support cumulative signed commitments between a funder and a designated recipient.

This allows multiple micropayments to be authorized off-chain and settled later.

However, conventional independent payment channels create limitations for organizations interacting with numerous providers.

**Fragmented funding**

Each provider channel requires its own funding allocation and associated channel infrastructure.

Organizations must manage available balances across multiple independent payment relationships.

**Operational complexity**

Agent platforms need to coordinate channel creation, signer management, funding, settlement, monitoring and reconciliation across providers.

**Limited shared treasury coordination**

Existing individual channels do not inherently provide one pooled treasury with independently collateralized virtual channels for numerous recipients.

**Repeated settlement operations**

Independent providers typically redeem their channels separately. Coordinating multiple claims into one transaction requires additional settlement infrastructure.

**Delegated spending risk**

Organizations need to give agents bounded payment authority without granting unrestricted access to their treasury.

AgentBatch addresses these limitations while building on the established security model of cumulative payment vouchers.

### 4. The Solution

AgentBatch introduces a shared settlement architecture centered on a Soroban treasury contract.

An organization deposits USDC once into the contract.

The contract maintains internal accounting for the treasury and independent virtual payment channels.

Each virtual channel is associated with:

- A specific service provider.
- A delegated agent signing key.
- An allocated collateral ceiling.
- A cumulative redeemed amount.
- Channel-specific authorization and lifecycle rules.

The shared treasury reserves sufficient collateral for each channel, preventing different providers from claiming the same funds.

Agents authorize micropayments through signed cumulative vouchers.

Providers verify these commitments locally and can deliver services without waiting for a Stellar transaction on every request.

When settlement is required, several valid vouchers can be submitted in one batch.

The contract verifies the commitments, calculates incremental payments, updates accounting and transfers USDC to the designated providers.

This reduces the number of independently submitted settlement transactions without compromising provider-level collateral accounting.

### 5. Example Payment Workflow

Consider an organization operating AI agents that consume three services:

- AI inference provider.
- Search API provider.
- Data retrieval provider.

The organization deposits 100 USDC into AgentBatch.

It opens three virtual channels:

| Channel | Collateral allocation |
|---|---:|
| AI inference | 40 USDC |
| Search API | 35 USDC |
| Data retrieval | 15 USDC |
| Unallocated treasury balance | 10 USDC |

The agents begin consuming services.

Instead of initiating on-chain transfers, they issue signed cumulative payment vouchers.

After multiple requests, the providers hold vouchers authorizing:

| Provider | Cumulative amount |
|---|---:|
| AI inference | 12 USDC |
| Search API | 8 USDC |
| Data retrieval | 5 USDC |
| **Total** | **25 USDC** |

A settlement coordinator submits these three vouchers to AgentBatch in one Soroban transaction.

The contract validates every voucher and transfers the corresponding amounts to the three independent providers.

After settlement:

- Total paid: 25 USDC.
- Remaining contract balance: 75 USDC.
- Remaining collateral reserved across channels: 65 USDC.
- Unallocated treasury funds: 10 USDC.

The three payment relationships remain independent even though they use the same treasury contract.

If the AI inference provider later receives a voucher authorizing a cumulative payment of 17 USDC, only the additional 5 USDC is payable because the previous 12 USDC has already been redeemed.

This demonstrates the combined benefit of shared funding, cumulative voucher accounting and batched settlement.

### 6. Core Technical Architecture

AgentBatch is built around a reusable Soroban settlement contract and off-chain integration components.

#### 6.1 Shared Treasury

The treasury contract accepts supported Stellar assets through the SEP-41 token interface, including Stellar USDC.

It maintains:

- Deposited balance.
- Available unallocated balance.
- Reserved collateral per channel.
- Cumulative provider payouts.
- Authorized withdrawals.
- Treasury and channel identifiers.

Treasuries are logically isolated so funds belonging to one organization cannot satisfy another organization's payment obligations.

The initial PoC supports one treasury. The production architecture extends this to multiple organizations.

#### 6.2 Virtual Payment Channels

Virtual channels are internal Soroban contract records rather than separate smart-contract deployments.

Each channel defines its provider, delegated signer, collateral allocation, redeemed amount and lifecycle rules.

Multiple channels can be opened from the same treasury without deploying or individually funding separate channel contracts.

Each channel is financially isolated through explicit collateral reservations.

The system does not permit the same collateral to guarantee multiple independent payment obligations.

#### 6.3 Off-Chain Cumulative Vouchers

An AI agent signs a cumulative payment commitment using an Ed25519 signing key.

The signed payload binds the commitment to its intended execution context, including:

- Stellar network.
- AgentBatch contract.
- Treasury.
- Channel.
- Provider.
- Authorized signing key.
- Cumulative payment amount.
- Signature-domain version.

A service provider verifies the signature off-chain against authenticated channel configuration.

The provider also checks that the cumulative amount is greater than its previously accepted amount and does not exceed the channel's permitted ceiling.

No new blockchain transaction is required for each paid API interaction.

During redemption, Soroban verifies the signed commitment against the channel state.

Previously redeemed amounts cannot be claimed again.

#### 6.4 Coordinated Batch Settlement

AgentBatch exposes a batch redemption mechanism allowing multiple independent payment channels to be settled in one Soroban transaction.

For each submitted voucher, the contract:

1. Loads the registered channel.
2. Verifies the signature and domain.
3. Checks the channel allocation and cumulative payment limit.
4. Rejects stale or replayed commitments.
5. Calculates the incremental amount owed.
6. Updates redemption and treasury accounting.
7. Transfers the incremental payment to the immutable provider address.

The batch is atomic: if validation or settlement fails, the entire transaction reverts.

Batch capacity is constrained by Soroban execution and resource limits.

The protocol aims to reduce settlement transaction overhead, but actual network-fee savings must be established through benchmarks.

**Batch settlement does not inherently provide payment netting.**

The base architecture pays each provider its independently owed amount.

Bilateral or multilateral netting of compatible obligations is a separate potential extension requiring explicit authorization and a defined clearing model.

### 7. Security and Collateral Guarantees

Collateral safety is fundamental to AgentBatch.

Each channel has its own allocation ceiling.

Funds allocated to one provider cannot be withdrawn or reallocated while needed to honor that provider's valid outstanding commitments.

The contract maintains the accounting invariant:

**Total deposits − provider payouts − authorized withdrawals = available funds + remaining channel reservations**

For every channel:

**Remaining reservation = allocated collateral − cumulative redeemed amount**

Security controls include:

- Treasury-owner authentication.
- Per-channel spending ceilings.
- Immutable provider binding for signed vouchers.
- Domain-separated signatures.
- Replay and cross-channel protection.
- Checked token arithmetic.
- Atomic batch redemption.
- Prevention of collateral double allocation.
- Protection against unauthorized withdrawals.
- Treasury solvency checks.
- Appropriate Soroban storage-lifecycle handling.

A compromised agent signing key must not authorize payments beyond its channel allocation.

Production channel revocation and closure must also preserve payment claims legitimately authorized before the channel is terminated.

Provider claims cannot be invalidated simply because a treasury administrator changes a signing key or revokes an agent.

These properties require adversarial testing and independent security review before production deployment.

### 8. Advanced Treasury Management

The production architecture includes dynamic management of reserved and available treasury funds.

Organizations can:

- Allocate collateral across multiple agents and providers.
- Increase channel spending ceilings.
- Reassign funds that are not committed to outstanding claims.
- Rotate delegated signing keys.
- Suspend compromised agents.
- Initiate protected channel closure.
- Reconcile provider payments.
- Monitor available and reserved treasury balances.
- Export settlement history.

The objective is to simplify treasury administration without introducing unsecured credit or reusing funds already committed to providers.

### 9. Ecosystem Integrations

AgentBatch is designed to complement existing Stellar payment infrastructure.

#### Stellar MPP

Stellar's MPP channel mechanism already supports cumulative off-chain micropayments.

AgentBatch extends the model with shared treasury coordination and multi-provider virtual channels.

MPP compatibility requires an explicit integration adapter or payment-scheme extension.

#### x402 Facilitators

AgentBatch can serve as a settlement backend for compatible x402 facilitators.

A facilitator may handle payment challenges, API authentication and request verification while AgentBatch manages collateralized payment channels and batched USDC settlement.

Existing facilitator interfaces cannot be assumed to support AgentBatch vouchers without an adapter.

#### AI Agent Frameworks

Agent frameworks can integrate AgentBatch through an open TypeScript SDK.

The SDK provides interfaces for treasury management, channel creation, delegated signing, voucher verification and settlement operations.

#### Stellar Wallets and Institutional Platforms

Wallets, AI platforms and enterprise treasury applications can expose AgentBatch functionality through their existing interfaces.

### 10. Main Use Cases

#### 10.1 High-Frequency AI Inference

An agent consumes repeated inference requests from an external model provider.

Each request creates an incremental payment commitment.

The provider verifies the voucher instantly and periodically settles accumulated payments.

#### 10.2 One Agent, Multiple API Providers

One autonomous agent purchases inference, search, structured data and computation services.

A shared treasury finances separate provider channels with independent limits and accounting.

#### 10.3 Enterprise Multi-Agent Operations

An organization operates research, analytics and automation agents.

Each agent receives bounded delegated payment authority.

Finance and operations teams monitor exposure through centralized treasury reporting.

#### 10.4 Agent-to-Agent Payments

A coordinating agent delegates tasks to specialist agents providing retrieval, verification, reasoning and tool execution.

Each paid provider receives independently authorized vouchers.

A completed workflow can produce several provider claims that are settled together.

#### 10.5 AI Tool Marketplaces

A marketplace provides access to independently operated tools and APIs.

AgentBatch can manage collateral and settlement for many provider relationships through shared infrastructure.

### 11. Originality Within Stellar

AgentBatch does not claim to invent off-chain micropayments, Ed25519 vouchers or cumulative payment channels.

Those capabilities already exist in Stellar's broader payment infrastructure.

Its proposed differentiation is the integrated combination of:

**Shared multi-provider funding**

One organization-funded treasury supports many virtual payment channels.

**Virtual channels without independent deployments**

Channels are internal records under a common Soroban settlement contract.

**Independent collateral guarantees**

Each provider has an isolated spending allocation backed by reserved treasury funds.

**Coordinated multi-provider settlement**

Independent signed claims can be processed together through one atomic batch.

**Bounded delegated spending**

Agents can authorize payments without controlling the complete treasury.

**Reusable settlement integration**

Facilitators, AI platforms and wallets can integrate common collateral and settlement functionality rather than build their own bespoke escrow infrastructure.

These features distinguish AgentBatch's proposed architecture from a standalone one-way payment channel or generic x402 facilitator.

Related Stellar projects may already implement individual elements such as API micropayment batching, delegated spending policies or payment channels. AgentBatch's novelty claim therefore concerns the combined shared-treasury and provider-isolated settlement architecture, not exclusive ownership of those individual mechanisms.

### 12. Utility for Stellar

AgentBatch aims to increase Stellar's usefulness as a payment and settlement network for autonomous agents and machine-to-machine commerce.

Its potential benefits include:

**New payment activity**

AI platforms can use Stellar USDC to pay independent services through repeatable, usage-based workflows.

**Greater USDC utility**

Organizations can maintain USDC-funded operating treasuries to support AI-agent payments.

**More efficient settlement**

Multiple off-chain micropayment commitments can be aggregated into fewer on-chain settlement transactions.

**Reusable financial infrastructure**

Payment facilitators and agent platforms gain access to common treasury and settlement primitives.

**Expanded developer adoption**

Open-source contracts, SDKs and integration examples reduce the engineering work required to introduce collateralized AI micropayments.

**Institutional treasury control**

Organizations can manage bounded agent spending authority and track financial exposure across their workflows.

Success should be measured by actual network activity, not merely by reducing transaction counts.

Relevant production metrics include:

- Active organizations and treasuries.
- Number of active AI agents and providers.
- Active virtual channels.
- Signed micropayment volume.
- USDC settlement volume.
- Number of settled batches.
- Average claims per settlement transaction.
- Settlement fees and resource consumption.
- External SDK and facilitator integrations.

### 13. Long-Term Product Components

The complete AgentBatch infrastructure comprises:

**Soroban settlement contract**

Handles treasury accounting, virtual channels, signatures, collateral reservations and redemption.

**TypeScript SDK**

Provides payment-channel creation, voucher generation, verification and settlement interfaces.

**Settlement coordinator**

Collects eligible provider vouchers and submits bounded batches for on-chain settlement.

**Treasury Console**

Provides allocation management, spending limits, agent monitoring, channel lifecycle controls and payment reconciliation.

**Payment adapters**

Connect AgentBatch to supported MPP, x402 and AI-payment workflows.

**Security and monitoring infrastructure**

Includes events, indexing, observability, incident response procedures, contract verification, deployment manifests and integration documentation.

### 14. Advanced Research and Future Extensions

Potential subsequent functionality includes:

- Permissionless keeper settlement with bounded incentives.
- Passkey-backed authorization via compatible Stellar account mechanisms.
- Privacy-preserving payment metadata.
- Verifiable usage commitments.
- Advanced agent spending policies.
- Payment-channel interoperability standards.
- Bilateral or multilateral netting of compatible obligations.

These are separate development objectives.

In particular, a usage commitment hash does not independently prove service delivery, and multilateral netting requires a distinct authorization, obligation and settlement model.

Neither should be claimed as an existing guarantee of the base protocol.

### 15. Initial Proof of Concept — Intentionally Limited Scope

Before applying for SCF #46 funding, the team intends to demonstrate the feasibility of AgentBatch's central settlement architecture.

**The PoC is not the complete product.**

It focuses on one Soroban contract, one treasury, three independent providers and a synthetic Stellar payment asset.

The PoC demonstrates:

1. A single treasury deposit.
2. Three internally recorded virtual channels.
3. Independent collateral allocations.
4. Real Ed25519 cumulative vouchers.
5. Provider-side off-chain signature verification.
6. Multiple micropayment requests without per-request on-chain transfers.
7. One atomic redemption transaction paying three providers.
8. Correct balance accounting and replay protection.
9. Automated tests and verifiable Stellar Testnet results.

The PoC intentionally excludes production channel closure, dynamic collateral recycling, multi-tenant treasury infrastructure, facilitator integration, a production Treasury Console, advanced clearing and mainnet deployment.

The objective is to demonstrate that the fundamental architecture works on Stellar and that the team has the engineering expertise to deliver the remaining infrastructure.

### 16. Development Planned for SCF Funding

The grant-funded work transforms the limited PoC into secure, scalable and reusable settlement infrastructure.

#### Tranche 1 — Production Treasury and Channel Infrastructure

Develop:

- Multi-tenant treasury management.
- Production channel lifecycle.
- Safe collateral allocation and reallocation.
- Controlled top-ups and withdrawals.
- Secure signer rotation.
- Revocation and challenge-period closure.
- Expanded accounting and security tests.

#### Tranche 2 — Scalable Settlement and Integration

Develop:

- Resource-efficient batch processing.
- Multi-provider settlement coordination.
- Keeper mechanisms and incentive controls.
- Complete TypeScript SDK.
- MPP and x402 integration adapters.
- Reproducible workload and fee benchmarks.
- Comprehensive Testnet integration testing.

#### Tranche 3 — Mainnet Readiness and Ecosystem Adoption

Develop:

- Treasury Console and settlement monitoring.
- Production deployment tooling.
- Independent security review and remediation.
- Documentation and developer examples.
- Real AI-service integration pilots.
- Mainnet deployment.
- Public usage and settlement analytics.

These are proposed workstreams; their budgets and acceptance criteria should be finalized after validating the PoC and engineering estimates.

The grant does not seek funding for functionality already completed before its award.

### 17. Success Criteria

The project's success depends on demonstrating that AgentBatch provides meaningful advantages over independently funded payment channels while preserving equivalent payment security.

Key technical acceptance criteria include:

- Correct multi-tenant collateral accounting.
- No unauthorized cross-channel withdrawals.
- Valid cumulative voucher authentication.
- Replay-resistant payments.
- Safe revocation and channel closure.
- Atomic settlement across multiple providers.
- Deterministic and reproducible contract behavior.
- Resource-efficient batched redemption.
- Tested compatibility with selected Stellar payment integrations.

Economic benchmarks should compare AgentBatch with individual payment channels using the same number of users, providers, commitments and token transfers.

Measurements must distinguish transaction count, computational resources, network fees and operational complexity.

### 18. Project Positioning

AgentBatch is not another AI application, wallet, payment facilitator or isolated micropayment channel.

It is a shared treasury and settlement coordination primitive designed to make repeated payments between autonomous agents and independent service providers more practical on Stellar.

Its central innovation is combining a common funded treasury with independently secured virtual channels and coordinated multi-provider settlement.

**One treasury. Multiple independent providers. Off-chain micropayments. Coordinated on-chain settlement.**

### 19. Technical Boundaries and Assumptions

The complete product must preserve the following principles:

- Every valid payment claim is backed by its own reserved collateral.
- Shared custody does not imply that the same collateral can be promised twice.
- Providers cannot receive amounts above their channel allocation.
- Permissionless batch submission must never permit changing the designated recipient.
- Revoking an agent cannot silently destroy valid provider claims.
- Batched settlement reduces settlement transaction count but does not automatically reduce all network resource costs.
- Batch settlement and obligation netting are distinct mechanisms.
- x402 and Stellar MPP compatibility requires explicit integration work.
- Security claims apply only to implemented and validated functions.
- Production funds must not be accepted before the protocol completes appropriate testing and independent security review.
