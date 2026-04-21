import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { startTokenProvider, stopTokenProvider, currentToken } from "./token-provider"

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const saved: Record<string, string | undefined> = {}
    for (const key of Object.keys(vars)) {
      saved[key] = process.env[key]
    }
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    try {
      await fn()
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  }
}

describe("startTokenProvider / stopTokenProvider", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-provider-test-"))
    stopTokenProvider()
  })

  afterEach(() => {
    stopTokenProvider()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test(
    "PAT mode: writes token to file and exposes via currentToken()",
    withEnv(
      {
        GITHUB_TOKEN: "test-pat-12345",
        GITHUB_TOKEN_FILE: path.join(os.tmpdir(), "token-provider-test-token"),
        GITHUB_APP_ID: undefined,
        GITHUB_APP_PRIVATE_KEY: undefined,
        GITHUB_APP_INSTALLATION_ID: undefined,
      },
      async () => {
        const tokenFile = process.env["GITHUB_TOKEN_FILE"]!
        await startTokenProvider()
        expect(currentToken()).toBe("test-pat-12345")
        expect(fs.existsSync(tokenFile)).toBe(true)
        expect(fs.readFileSync(tokenFile, "utf-8")).toBe("test-pat-12345")
        const stat = fs.statSync(tokenFile)
        expect(stat.mode & 0o777).toBe(0o600)
      },
    ),
  )

  test(
    "no credentials: does not throw, currentToken() returns null",
    withEnv(
      {
        GITHUB_TOKEN: undefined,
        GITHUB_APP_ID: undefined,
        GITHUB_APP_PRIVATE_KEY: undefined,
        GITHUB_APP_INSTALLATION_ID: undefined,
      },
      async () => {
        await startTokenProvider()
        expect(currentToken()).toBeNull()
      },
    ),
  )

  test("stopTokenProvider() clears current token", async () => {
    process.env["GITHUB_TOKEN"] = "temp-token"
    process.env["GITHUB_TOKEN_FILE"] = path.join(tmpDir, ".gh-token")
    await startTokenProvider()
    expect(currentToken()).toBe("temp-token")
    stopTokenProvider()
    expect(currentToken()).toBeNull()
    delete process.env["GITHUB_TOKEN"]
    delete process.env["GITHUB_TOKEN_FILE"]
  })
})
