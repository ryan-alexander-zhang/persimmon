import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { exportFile, isDnsLabel, parseImport, readLocation, save } from "./document";
import type { Model } from "./eventstorming/grammar";
import { useESStore } from "./store/store";

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
  it("exports the Resource envelope the engine reads back, carrying the next revision", () => {
    const file = exportFile("expense-claims", 2, model);
    expect(file.name).toBe("expense-claims.r3.yaml");
    expect(YAML.parse(file.yaml)).toEqual({
      apiVersion: "sdd.persimmon.ai/v1",
      kind: "EventStorming",
      metadata: { name: "expense-claims.r3" },
      spec: { identity: { id: "expense-claims", revision: 3 }, content: model },
    });
  });

  it("exports an unsaved model as r1", () => {
    const file = exportFile("claims", null, model);
    expect(file.name).toBe("claims.r1.yaml");
    expect(YAML.parse(file.yaml).spec.identity.revision).toBe(1);
  });

  it("round-trips its own export", () => {
    expect(parseImport(exportFile("claims", 1, model).yaml)).toEqual(model);
  });

  it("reads a bare old .eventstorming.json, dropping meta.createdAt", () => {
    const old = {
      ...model,
      meta: { ...model.meta, createdAt: "2026-01-01T00:00:00Z" },
    };
    expect(parseImport(JSON.stringify(old))).toEqual(model);
  });

  it("names what the file is when it is not a v4.0 model", () => {
    expect(() => parseImport(JSON.stringify({ ...model, version: "3.0" }))).toThrow(
      "not a DSL 4.0 model",
    );
    expect(() => parseImport(JSON.stringify({ version: "4.0" }))).toThrow("not a DSL 4.0 model");
    expect(() => parseImport(JSON.stringify({ version: "4.0", meta: "Claims" }))).toThrow(
      "not a DSL 4.0 model",
    );
    expect(() => parseImport("")).toThrow("not a DSL 4.0 model");
  });

  it("names the kind of a Resource that is not an EventStorming", () => {
    expect(() =>
      parseImport(YAML.stringify({ kind: "Workflow", spec: { content: model } })),
    ).toThrow("a Resource of kind Workflow, not EventStorming");
  });
});

describe("saving declares the revision it was edited from", () => {
  afterEach(() => vi.unstubAllGlobals());

  // `navigate` moves the URL onto the saved revision; the save itself is what is
  // under test, so the page it would move is the smallest possible stub.
  const stubPage = () => {
    vi.stubGlobal("window", { history: { pushState: () => {} }, dispatchEvent: () => {} });
    vi.stubGlobal("PopStateEvent", class {});
  };

  const stubApi = (status: number, body: unknown) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    return bodies;
  };

  it("sends the open revision as the base, and none for a model never saved", async () => {
    stubPage();
    const bodies = stubApi(201, {
      apiVersion: "sdd.persimmon.ai/v1",
      kind: "EventStorming",
      namespace: "default",
      id: "claims",
      revision: 4,
    });

    useESStore
      .getState()
      .openDocument({ namespace: "default", id: "claims", revision: 3, readOnly: false }, model);
    await save();
    expect(bodies[0]?.base).toBe(3);
    expect(useESStore.getState().doc?.revision).toBe(4);

    useESStore.getState().newDocument("default", "fresh");
    await save();
    expect(bodies[1]).not.toHaveProperty("base");

    // "Edit as new revision" forks: the base is the latest, not the board's revision.
    useESStore
      .getState()
      .openDocument({ namespace: "default", id: "claims", revision: 2, readOnly: true }, model);
    useESStore.getState().editAsNewRevision(7);
    await save();
    expect(bodies[2]?.base).toBe(7);
  });

  it("tells the modeller to reload when the API answers 409 conflict", async () => {
    stubPage();
    stubApi(409, { error: { code: "conflict", message: "base 3 is not the latest revision" } });
    useESStore
      .getState()
      .openDocument({ namespace: "default", id: "claims", revision: 3, readOnly: false }, model);
    await expect(save()).rejects.toThrow("no longer the latest revision");
  });
});
