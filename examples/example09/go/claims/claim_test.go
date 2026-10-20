package claims

import (
	"reflect"
	"testing"
)

func TestAMealsLineOf30WithoutAReceiptIsNotComplete(t *testing.T) {
	if Draft("e1", []Line{{Amount: 30, Category: "meals"}}).Complete() {
		t.Fatal("complete")
	}
}

func TestAPerDiemLineNeedsNoReceipt(t *testing.T) {
	if !Draft("e1", []Line{{Amount: 60, Category: "per-diem"}}).Complete() {
		t.Fatal("not complete")
	}
}

func TestDraftingAClaimRecordsEachLine(t *testing.T) {
	lines := []Line{{Amount: 12, Category: "taxi"}}
	if got := Draft("e1", lines).Lines; !reflect.DeepEqual(got, lines) {
		t.Fatal(got)
	}
}

func TestATaxiLineOf25WithoutAReceiptIsNotComplete(t *testing.T) {
	if Draft("e1", []Line{{Amount: 25, Category: "taxi"}}).Complete() {
		t.Fatal("complete")
	}
}

func TestAttachingAReceiptToAnotherEmployeesClaimIsRefusedAndLogged(t *testing.T) {
	c := Draft("e1", []Line{{Amount: 30, Category: "meals"}})
	if c.AttachReceipt("/claims/c-e1/r1", "e2") || !reflect.DeepEqual(c.Log, []string{"refused /claims/c-e1/r1 by e2"}) {
		t.Fatal(c.Log)
	}
}
