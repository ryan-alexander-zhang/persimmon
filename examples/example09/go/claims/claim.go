// Package claims holds the Claim aggregate (the worked example's T-1): lines, receipts, completeness under BR-2.
package claims

import "strings"

const ReceiptThreshold = 25

type Line struct {
	Amount   int
	Category string
	Receipt  string
}

type Claim struct {
	ID, Employee string
	Lines        []Line
	Log          []string
}

func Draft(employee string, lines []Line) *Claim {
	return &Claim{ID: "c-" + employee, Employee: employee, Lines: append([]Line(nil), lines...)}
}

func LineComplete(l Line) bool {
	return l.Category == "per-diem" || l.Amount < ReceiptThreshold || l.Receipt != ""
}

func (c *Claim) Complete() bool {
	for _, l := range c.Lines {
		if !LineComplete(l) {
			return false
		}
	}
	return true
}

func (c *Claim) AttachReceipt(url, by string) bool {
	if !strings.Contains(url, "/claims/"+c.ID+"/") || by != c.Employee {
		c.Log = append(c.Log, "refused "+url+" by "+by)
		return false
	}
	c.Lines[0].Receipt = url
	return true
}
