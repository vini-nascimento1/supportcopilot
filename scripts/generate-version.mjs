// Generates public/version.json at build time so the client can detect new deploys.
import { execSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

// Vercel's build sandbox doesn't reliably expose a working .git checkout, so
// `git rev-parse` silently fails there and every deploy fell back to the same
// "unknown" sha — which broke the update banner (it only flips on when the
// sha changes). Vercel injects the real commit sha as an env var regardless;
// prefer that, and only shell out to git for local dev where it's unset.
let sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || ""
if (!sha) {
  try {
    sha = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
  } catch {
    sha = "unknown"
  }
}

const version = {
  sha,
  timestamp: new Date().toISOString(),
}

const json = JSON.stringify(version, null, 2) + "\n"

// Write to public/ (dev) and .next/public/ (build output)
writeFileSync(join(root, "public", "version.json"), json)

const nextPublic = join(root, ".next", "public")
try {
  mkdirSync(nextPublic, { recursive: true })
  writeFileSync(join(nextPublic, "version.json"), json)
} catch {
  // .next might not exist yet during dev — that's fine.
}
