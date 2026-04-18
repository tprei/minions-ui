import { vi } from 'vitest'

export const useRegisterSW = vi.fn().mockReturnValue({
  needRefresh: [false, vi.fn()],
  offlineReady: [false, vi.fn()],
  updateServiceWorker: vi.fn().mockResolvedValue(undefined),
})
