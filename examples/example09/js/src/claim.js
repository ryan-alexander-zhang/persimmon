// The Claim aggregate (the worked example's T-1): lines, receipts, completeness under BR-2.
export const RECEIPT_THRESHOLD = 25

export const draftClaim = (employee, lines) => ({ id: `c-${employee}`, employee, lines: lines.map((l) => ({ ...l })), log: [] })

export function lineComplete(line) {
  return line.category === 'per-diem' || line.amount < RECEIPT_THRESHOLD || Boolean(line.receipt)
}

export function claimComplete(claim) {
  return claim.lines.every(lineComplete)
}

export function attachReceipt(claim, url, employee) {
  if (!url.includes(`/claims/${claim.id}/`) || employee !== claim.employee) {
    claim.log.push(`refused ${url} by ${employee}`)
    return false
  }
  claim.lines[0].receipt = url
  return true
}
