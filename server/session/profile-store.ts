import fs from 'node:fs'
import path from 'node:path'
import type { ProviderProfile } from '../../shared/api-types'

interface ProfilesFile {
  profiles: ProviderProfile[]
  defaultId?: string
}

function atomicWrite(filePath: string, data: string): void {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, `.tmp-profiles-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  fs.writeFileSync(tmp, data, 'utf8')
  fs.renameSync(tmp, filePath)
}

export class ProfileStore {
  private readonly filePath: string

  constructor(workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, 'profiles.json')
  }

  load(): ProfilesFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as ProfilesFile).profiles)) {
        return { profiles: [] }
      }
      return parsed as ProfilesFile
    } catch {
      return { profiles: [] }
    }
  }

  list(): ProviderProfile[] {
    return this.load().profiles
  }

  get(id: string): ProviderProfile | undefined {
    return this.load().profiles.find((p) => p.id === id)
  }

  add(profile: ProviderProfile): void {
    const data = this.load()
    if (data.profiles.some((p) => p.id === profile.id)) {
      throw new Error(`Profile with id "${profile.id}" already exists`)
    }
    data.profiles.push(profile)
    this.persist(data)
  }

  update(id: string, patch: Partial<Omit<ProviderProfile, 'id'>>): ProviderProfile {
    const data = this.load()
    const idx = data.profiles.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error(`Profile "${id}" not found`)
    const updated = { ...data.profiles[idx]!, ...patch }
    data.profiles[idx] = updated
    this.persist(data)
    return updated
  }

  remove(id: string): void {
    const data = this.load()
    const idx = data.profiles.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error(`Profile "${id}" not found`)
    data.profiles.splice(idx, 1)
    if (data.defaultId === id) {
      delete data.defaultId
    }
    this.persist(data)
  }

  getDefaultId(): string | undefined {
    return this.load().defaultId
  }

  setDefaultId(id: string): void {
    const data = this.load()
    if (!data.profiles.some((p) => p.id === id)) {
      throw new Error(`Profile "${id}" not found`)
    }
    data.defaultId = id
    this.persist(data)
  }

  clearDefault(): void {
    const data = this.load()
    delete data.defaultId
    this.persist(data)
  }

  private persist(data: ProfilesFile): void {
    const dir = path.dirname(this.filePath)
    fs.mkdirSync(dir, { recursive: true })
    atomicWrite(this.filePath, JSON.stringify(data, null, 2))
  }
}
