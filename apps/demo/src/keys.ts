import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { AgentSigner } from "@agentbatch/voucher";
import { Keypair } from "@stellar/stellar-sdk";

import { PATHS } from "./config.js";

interface KeyFile {
  note: string;
  issuer: string;
  owner: string;
  coordinator: string;
  providers: string[];
  agentSeeds: string[];
}

export interface DemoKeys {
  /** Issues the synthetic AUSD asset. */
  issuer: Keypair;
  /** Treasury owner: deploys, deposits, opens channels. */
  owner: Keypair;
  /** Third party that submits batch settlements (holds no treasury rights). */
  coordinator: Keypair;
  providers: Keypair[];
  /** Delegated agent signers: raw Ed25519 keys, distinct from every account key. */
  agents: AgentSigner[];
}

/** Loads Testnet keys from the gitignored `.secrets/` file, creating them on first use. */
export function loadOrCreateKeys(): DemoKeys {
  if (!existsSync(PATHS.keys)) {
    const file: KeyFile = {
      note: "Stellar Testnet keys for the AgentBatch PoC demo. Never use on Mainnet. Never commit.",
      issuer: Keypair.random().secret(),
      owner: Keypair.random().secret(),
      coordinator: Keypair.random().secret(),
      providers: [0, 1, 2].map(() => Keypair.random().secret()),
      agentSeeds: [0, 1, 2].map(() => randomBytes(32).toString("hex")),
    };
    mkdirSync(dirname(PATHS.keys), { recursive: true, mode: 0o700 });
    writeFileSync(PATHS.keys, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  }
  const file = JSON.parse(readFileSync(PATHS.keys, "utf8")) as KeyFile;
  return {
    issuer: Keypair.fromSecret(file.issuer),
    owner: Keypair.fromSecret(file.owner),
    coordinator: Keypair.fromSecret(file.coordinator),
    providers: file.providers.map((s) => Keypair.fromSecret(s)),
    agents: file.agentSeeds.map((h) => AgentSigner.fromSeed(Buffer.from(h, "hex"))),
  };
}
