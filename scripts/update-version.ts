#!/usr/bin/env bun
import { $ } from "bun";

/**
 * git describe --tags --always --dirty outputs:
 * - "v0.1.2" for a tag
 * - "v0.1.2-3-gabc123" for 3 commits after tag v0.1.2
 * - "v0.1.2-dirty" for uncommitted changes
 * - "abc123" if no tags (just commit hash)
 */
function parseGitDescribe(output: string): string {
  const trimmed = output.trim();
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

async function main() {
  let gitVersion: string;

  try {
    const result = await $`git describe --tags --always --dirty`.quiet();
    gitVersion = parseGitDescribe(result.stdout.toString());
  } catch {
    console.error("Warning: Could not get git version, keeping current version");
    process.exit(0);
  }

  const packagePath = new URL("../package.json", import.meta.url);
  const packageFile = Bun.file(packagePath);
  const pkg = await packageFile.json();

  if (pkg.version === gitVersion) {
    console.log(`Version already up to date: ${gitVersion}`);
    return;
  }

  pkg.version = gitVersion;
  await Bun.write(packagePath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`Updated version: ${gitVersion}`);
}

main();