import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

// `server-only` / `client-only` are import guards Next.js resolves at build
// time. Under vitest's plain Node runtime they aren't resolvable, so importing
// a server module (e.g. lib/attachments.ts, which guards itself with
// `import "server-only"`) at runtime would fail test collection. Alias them to
// an empty stub so server-only modules can be unit-tested directly.
const emptyStub = fileURLToPath(new URL("./test-stubs/empty-module.ts", import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "server-only": emptyStub,
      "client-only": emptyStub,
    },
  },
})
