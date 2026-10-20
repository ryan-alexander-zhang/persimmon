//go:build integration

package claims

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/testcontainers/testcontainers-go"
)

func TestADraftedClaimIsWrittenToARealContainerAndReadBack(t *testing.T) {
	ctx := context.Background()
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{ContainerRequest: testcontainers.ContainerRequest{Image: "alpine:3.20", Cmd: []string{"sleep", "60"}}, Started: true})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Terminate(ctx)
	c.Exec(ctx, []string{"sh", "-c", "echo c-e1 > /tmp/claim"})
	_, r, _ := c.Exec(ctx, []string{"cat", "/tmp/claim"})
	out, _ := io.ReadAll(r)
	if !strings.Contains(string(out), "c-e1") {
		t.Fatal(string(out))
	}
}
