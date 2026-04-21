import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const REFRESH_INTERVAL_MS = 45 * 60 * 1000
const GITHUB_API_BASE = "https://api.github.com"

function tokenFilePath(): string {
  const explicit = process.env["GITHUB_TOKEN_FILE"]
  if (explicit) return explicit
  const workspaceRoot = process.env["WORKSPACE_ROOT"] ?? process.cwd()
  return path.join(workspaceRoot, ".gh-token")
}

function writeTokenFile(token: string): void {
  const filePath = tokenFilePath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, token, { mode: 0o600 })
}

let _currentToken: string | null = null
let _refreshTimer: ReturnType<typeof setInterval> | null = null

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function buildJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })))
  const payload = base64url(
    Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })),
  )
  const signing = `${header}.${payload}`
  const sig = crypto.createSign("RSA-SHA256").update(signing).sign(privateKeyPem)
  return `${signing}.${base64url(sig)}`
}

async function fetchInstallationToken(
  appId: string,
  privateKeyPem: string,
  installationId: string,
): Promise<string> {
  const jwt = buildJwt(appId, privateKeyPem)

  const res = await fetch(
    `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  )

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`GitHub App token fetch failed: ${res.status} ${body}`)
  }

  const data = (await res.json()) as Record<string, unknown>
  if (typeof data["token"] !== "string") {
    throw new Error("GitHub App token response missing token field")
  }
  return data["token"]
}

async function refreshAppToken(): Promise<void> {
  const appId = process.env["GITHUB_APP_ID"]
  const privateKey = process.env["GITHUB_APP_PRIVATE_KEY"]
  const installationId = process.env["GITHUB_APP_INSTALLATION_ID"]

  if (!appId || !privateKey || !installationId) return

  const token = await fetchInstallationToken(appId, privateKey, installationId)
  _currentToken = token
  writeTokenFile(token)
}

export function currentToken(): string | null {
  return _currentToken
}

export async function startTokenProvider(): Promise<void> {
  const patToken = process.env["GITHUB_TOKEN"]
  if (patToken) {
    _currentToken = patToken
    writeTokenFile(patToken)
    return
  }

  const appId = process.env["GITHUB_APP_ID"]
  const privateKey = process.env["GITHUB_APP_PRIVATE_KEY"]
  const installationId = process.env["GITHUB_APP_INSTALLATION_ID"]

  if (!appId || !privateKey || !installationId) return

  await refreshAppToken()

  _refreshTimer = setInterval(() => {
    refreshAppToken().catch((err: unknown) => {
      console.error("[token-provider] refresh failed:", err)
    })
  }, REFRESH_INTERVAL_MS)
}

export function stopTokenProvider(): void {
  if (_refreshTimer !== null) {
    clearInterval(_refreshTimer)
    _refreshTimer = null
  }
  _currentToken = null
}
