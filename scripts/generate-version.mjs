// Generates public/version.json at build time so the client can detect new deploys.
import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

let sha = ""
try {
  sha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
} catch {
  sha = "unknown"
}

const version = {
  sha,
  timestamp: new Date().toISOString(),
}

writeFileSync(
  join(root, "public", "version.json"),
  JSON.stringify(version, null, 2) + "\n",
)
