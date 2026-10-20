package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"example.com/claims/claims"
)

const page = `<!doctype html><title>Claims</title><form id="f"><input id="amount" value="30"><select id="category"><option>meals</option><option>per-diem</option></select><button>Check</button></form><p id="out"></p>
<script>document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); const r = await fetch('/claims', { method: 'POST', body: JSON.stringify({ employee: 'e1', lines: [{ amount: Number(amount.value), category: category.value }] }) }); out.textContent = (await r.json()).complete ? 'complete' : 'incomplete' }</script>`

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			fmt.Fprint(w, page)
			return
		}
		var in struct {
			Employee string
			Lines    []claims.Line
		}
		json.NewDecoder(r.Body).Decode(&in)
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"complete": claims.Draft(in.Employee, in.Lines).Complete()})
	})
	http.ListenAndServe(":"+os.Args[1], nil)
}
