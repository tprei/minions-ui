import { describe, test, expect } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRealQualityGates } from "./quality-gates"

function makeTempProject(scripts: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gates-test-"))
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "test", scripts }),
  )
  return dir
}

function writeMinionsConfig(dir: string, config: Record<string, unknown>): void {
  fs.writeFileSync(path.join(dir, "minions.json"), JSON.stringify(config))
}

describe("createRealQualityGates", () => {
  test("returns allPassed:true with empty results when no package.json", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gates-empty-"))
    const gates = createRealQualityGates()
    const report = await gates.run(dir)
    expect(report.allPassed).toBe(true)
    expect(report.results).toHaveLength(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("returns allPassed:true when no known gate scripts are present", async () => {
    const dir = makeTempProject({ build: "echo building" })
    const gates = createRealQualityGates()
    const report = await gates.run(dir)
    expect(report.allPassed).toBe(true)
    expect(report.results).toHaveLength(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("detects and runs available gates, passing ones pass", async () => {
    const dir = makeTempProject({ lint: "echo lint ok", typecheck: "exit 0" })
    const gates = createRealQualityGates()
    const report = await gates.run(dir)
    const names = report.results.map((r) => r.name)
    expect(names).toContain("lint")
    expect(names).toContain("typecheck")
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("marks gate as failed when script exits non-zero", async () => {
    const dir = makeTempProject({ lint: "exit 1" })
    const gates = createRealQualityGates()
    const report = await gates.run(dir)
    expect(report.allPassed).toBe(false)
    const lintResult = report.results.find((r) => r.name === "lint")
    expect(lintResult?.passed).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("runs configured minions.json gates instead of package script discovery", async () => {
    const dir = makeTempProject({ lint: "exit 1" })
    writeMinionsConfig(dir, {
      quality: {
        gates: [
          { name: "configured", command: ["node", "-e", "console.log('configured ok')"] },
        ],
      },
    })
    const gates = createRealQualityGates()
    const report = await gates.run(dir)
    expect(report.allPassed).toBe(true)
    expect(report.results.map((r) => r.name)).toEqual(["configured"])
    expect(report.results[0]?.output).toContain("configured ok")
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("does not fail the report for optional gate failures", async () => {
    const dir = makeTempProject({})
    writeMinionsConfig(dir, {
      quality: {
        gates: [
          { name: "optional", command: ["node", "-e", "process.exit(1)"], required: false },
        ],
      },
    })
    const gates = createRealQualityGates()
    const report = await gates.run(dir)
    expect(report.allPassed).toBe(true)
    expect(report.results[0]?.passed).toBe(false)
    expect(report.results[0]?.required).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("invalid minions.json blocks quality gates", async () => {
    const dir = makeTempProject({})
    fs.writeFileSync(path.join(dir, "minions.json"), JSON.stringify({ quality: { gates: [{ name: "bad" }] } }))
    const gates = createRealQualityGates()
    const report = await gates.run(dir)
    expect(report.allPassed).toBe(false)
    expect(report.configError).toBeTruthy()
    expect(report.results[0]?.name).toBe("minions-config")
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
