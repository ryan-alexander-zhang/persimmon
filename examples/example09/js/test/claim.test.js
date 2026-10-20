import { describe, expect, it } from 'vitest'
import { attachReceipt, claimComplete, draftClaim } from '../src/claim.js'

describe('claim', () => {
  it('a 30 EUR meals line without a receipt is not complete and names BR-2', () => {
    expect(claimComplete(draftClaim('e1', [{ amount: 30, category: 'meals' }]))).toBe(false)
  })
  it('a per diem line needs no receipt', () => {
    expect(claimComplete(draftClaim('e1', [{ amount: 60, category: 'per-diem' }]))).toBe(true)
  })
  it("drafting a claim records each line's amount, date and category", () => {
    const c = draftClaim('e1', [{ amount: 12, date: '2026-10-01', category: 'taxi' }])
    expect(c.lines).toEqual([{ amount: 12, date: '2026-10-01', category: 'taxi' }])
  })
  it('a 25.00 EUR taxi line without a receipt is not complete and names BR-2', () => {
    expect(claimComplete(draftClaim('e1', [{ amount: 25, category: 'taxi' }]))).toBe(false)
  })
  it("attaching a receipt to another employee's claim by URL is refused and logged", () => {
    const c = draftClaim('e1', [{ amount: 30, category: 'meals' }])
    expect(attachReceipt(c, '/claims/c-e1/r1', 'e2')).toBe(false)
    expect(c.log).toEqual(['refused /claims/c-e1/r1 by e2'])
  })
})
