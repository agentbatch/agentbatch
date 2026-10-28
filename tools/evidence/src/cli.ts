import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, archiveLabel, directoryFromArgument, json, loadArchive, registeredRuns } from "./archive.js";
import { checkArchive } from "./check.js";
import { verifyArchive } from "./network.js";

async function main(): Promise<void> {
  const [command = "check", ...args] = process.argv.slice(2);
  let run: string | undefined, output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i], value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    if (flag === "--run") run = value;
    else if (flag === "--output") output = value;
    else throw new Error(`unknown option ${flag}`);
  }
  if (command === "check") {
    if (output) throw new Error("--output is supported only by verify");
    const directories = run ? [directoryFromArgument(run)] : registeredRuns().directories;
    for (const directory of directories) {
      const archive = loadArchive(directory);
      console.log(json({ run: archiveLabel(archive), ...checkArchive(archive) }));
    }
    return;
  }
  if (command !== "verify") throw new Error("usage: check|verify [--run <directory>] [--output <new-directory>]");
  // Reserve a fresh destination before network requests; archived evidence is never overwritten.
  const outputDirectory = output ? resolve(ROOT, output) : undefined;
  if (outputDirectory) mkdirSync(outputDirectory);
  const archive = loadArchive(directoryFromArgument(run));
  const result = await verifyArchive(archive, (message) => console.error(message));
  const report = { run: archiveLabel(archive), ...result.report };
  if (outputDirectory) {
    writeFileSync(resolve(outputDirectory, "verification.json"), json(report), { flag: "wx" });
    writeFileSync(resolve(outputDirectory, "authoritative-transactions.json"), json(result.authoritative), { flag: "wx" });
  }
  console.log(json(report));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
