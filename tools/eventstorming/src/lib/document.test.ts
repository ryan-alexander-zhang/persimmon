import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { isDnsLabel, parseImport, readLocation, toResourceYaml } from "./document";
import type { Model } from "./eventstorming/grammar";

const model: Model = {
  version: "4.0",
  meta: { name: "Expense claims", level: "process" },
  contexts: [],
  contextRelationships: [],
  nodes: [],
  edges: [],
};

describe("the open revision is the URL", () => {
  it("reads namespace, id and revision, defaulting both", () => {
    expect(readLocation("?ns=team&id=claims&rev=3")).toEqual({
      namespace: "team",
      id: "claims",
      revision: 3,
    });
    expect(readLocation("")).toEqual({ namespace: "default", id: null, revision: "latest" });
    expect(readLocation("?id=claims&rev=x").revision).toBe("latest");
  });

  it("holds an artifact id to a DNS label", () => {
    expect(isDnsLabel("expense-claims")).toBe(true);
    expect(isDnsLabel("Expense Claims")).toBe(false);
    expect(isDnsLabel("-leading")).toBe(false);
    expect(isDnsLabel("")).toBe(false);
  });
});

describe("the file a model travels in", () => {
  it("exports the Resource envelope the engine reads back", () => {
    const resource = YAML.parse(toResourceYaml("expense-claims", 2, model));
    expect(resource).toEqual({
      apiVersion: "sdd.persimmon.ai/v1",
      kind: "EventStorming",
      metadata: { name: "expense-claims.r2" },
      spec: { identity: { id: "expense-claims", revision: 2 }, content: model },
    });
  });

  it("round-trips its own export", () => {
    expect(parseImport(toResourceYaml("claims", 1, model))).toEqual(model);
  });

  it("reads a bare old .eventstorming.json, dropping meta.createdAt", () => {
    const old = {
      ...model,
      meta: { ...model.meta, createdAt: "2026-01-01T00:00:00Z" },
    };
    expect(parseImport(JSON.stringify(old))).toEqual(model);
  });
});
