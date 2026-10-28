/** No network access, funded accounts, private key files or transactions. */
import assert from "node:assert/strict";
import { AgentSigner, ChannelSpender, MemoryVoucherStore, ProviderVerifier } from "@agentbatch/voucher";
import { Keypair, Networks, StrKey } from "@stellar/stellar-sdk";

const agent = AgentSigner.random();
const owner = Keypair.random().publicKey();
const provider = Keypair.random().publicKey();
const scope = { networkPassphrase: Networks.TESTNET, contract: StrKey.encodeContract(Buffer.alloc(32, 1)) };
// Illustrative channel metadata. A real provider must pin code and asset and
// obtain this record from its trusted deployment before accepting requests.
const channel = { channelId: 1n, owner, provider, signer: agent.publicKey, allocation: 100_000_000n, redeemed: 0n };
const context = { ...scope, owner, provider, channelId: channel.channelId, signer: agent.publicKey };
const spender = new ChannelSpender(agent, context, channel.allocation);
const verifier = new ProviderVerifier({ ...scope, provider }, new MemoryVoucherStore(scope));

for (const price of [10_000_000n, 20_000_000n, 5_000_000n]) {
  const voucher = spender.pay(price);
  assert.equal(verifier.accept(channel, voucher, price).ok, true);
  assert.deepEqual(verifier.accept(channel, voucher, price), { ok: false, reason: "not-increasing" });
  console.log(`Accepted increment ${price}; cumulative authorization ${voucher.amount} base units`);
}
assert.equal(verifier.highest(channel), 35_000_000n);
console.log("Three offline payments verified; duplicate vouchers rejected. No transactions submitted.");
