import { describe, expect, it } from "vitest";
import { applyCurvature, getEdgeKey, reorder } from "../helpers";

describe("getEdgeKey", () => {
  it("joins source and target", () => {
    expect(getEdgeKey({ source: "a", target: "b" })).toBe("a_b");
  });
});

describe("reorder", () => {
  it("keeps edges whose source sorts after the target", () => {
    const edge = { source: "b", target: "a", label: "x" };
    expect(reorder([edge])).toEqual([edge]);
  });

  it("swaps ends so both directions share one key", () => {
    expect(reorder([{ source: "a", target: "b", label: "x" }])).toEqual([
      { source: "b", target: "a", label: "x" },
    ]);
  });
});

describe("applyCurvature", () => {
  it("leaves a single edge straight", () => {
    const edge = { source: "b", target: "a" };
    expect(applyCurvature([edge])).toEqual([edge]);
  });

  it("spreads parallel edges evenly around the line", () => {
    const edges = [
      { source: "b", target: "a" },
      { source: "b", target: "a" },
    ];
    expect(applyCurvature(edges, 0.5)).toEqual([
      { source: "b", target: "a", curvature: 0.5, rotation: 0 },
      { source: "b", target: "a", curvature: 0.5, rotation: Math.PI },
    ]);
  });

  it("curves a self-loop, using a curvature of 1 by default", () => {
    expect(applyCurvature([{ source: "a", target: "a" }])).toEqual([
      { source: "a", target: "a", curvature: 1, rotation: 0 },
    ]);
  });
});
