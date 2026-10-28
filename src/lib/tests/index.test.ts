import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KineticaGraphViz from "../index";

// Stand-in for the 3d-force-graph instance; every method is chainable.
const makeGraph = () => {
  const graph: any = {};
  for (const method of [
    "width",
    "height",
    "pauseAnimation",
    "resumeAnimation",
    "linkCurvature",
    "linkCurveRotation",
    "graphData",
    "_destructor",
  ]) {
    graph[method] = vi.fn(() => graph);
  }
  const renderer = { dispose: vi.fn(), forceContextLoss: vi.fn() };
  const controls = { dispose: vi.fn() };
  const composer = { dispose: vi.fn(), addPass: vi.fn() };
  graph.renderer = vi.fn(() => renderer);
  graph.controls = vi.fn(() => controls);
  graph.postProcessingComposer = vi.fn(() => composer);
  return graph;
};

let graph: any;

vi.mock("3d-force-graph", () => ({
  default: vi.fn(() => () => graph),
}));

// Each request waits until the test answers it, so tests control ordering.
type Request = {
  table: string;
  columns: string[];
  limit: number;
  respond: (columns: any) => void;
  fail: (error: Error) => void;
};
let requests: Request[];

vi.mock("../../gpudb/GPUdb", () => ({
  default: vi.fn(function () {
    this.get_records_by_column = vi.fn(
      (
        table: string,
        columns: string[],
        _offset: number,
        limit: number,
        _options: any,
        callback: any
      ) => {
        requests.push({
          table,
          columns,
          limit,
          respond: (columns) => callback(null, { data: columns }),
          fail: (error) => callback(error, null),
        });
      }
    );
  }),
}));

const RAW = {
  nodes: [{ id: "a" }, { id: "b" }],
  edges: [{ source: "a", target: "b" }],
};

const create = () => {
  const viz = new KineticaGraphViz("graph", {});
  viz.connect("http://kinetica.test:9191", {});
  return viz;
};

// The node ids passed to the most recent graphData() call.
const drawnNodeIds = () =>
  graph.graphData.mock.lastCall[0].nodes.map((node: any) => node.id);

// The nodes and links passed to the most recent graphData() call.
const drawn = () => graph.graphData.mock.lastCall[0];

beforeEach(() => {
  graph = makeGraph();
  requests = [];
  document.body.innerHTML = '<div id="graph"></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("render", () => {
  it("draws raw nodes and edges and resumes animation", async () => {
    await create().raw(RAW).render();

    expect(drawnNodeIds()).toEqual(["a", "b"]);
    expect(graph.graphData.mock.lastCall[0].links).toHaveLength(1);
    expect(graph.resumeAnimation).toHaveBeenCalled();
  });

  it("does not log to the console", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await create().raw(RAW).render();
    expect(log).not.toHaveBeenCalled();
  });

  it("loads a data table", async () => {
    const rendering = create().data("graph.out", ["a", "b"]).render();
    requests[0].respond({ column_1: [1, 2], column_2: [2, 3] });
    await rendering;

    expect(requests.map((request) => request.table)).toEqual(["graph.out"]);
    expect(drawnNodeIds()).toEqual([1, 2, 3]);
  });

  it("loads node and edge tables in parallel", async () => {
    const rendering = create()
      .nodes("graph.nodes", ["id"])
      .edges("graph.edges", ["n1", "n2"])
      .render();

    expect(requests.map((request) => request.table)).toEqual([
      "graph.nodes",
      "graph.edges",
    ]);
    requests[1].respond({ column_1: [1], column_2: [2] });
    requests[0].respond({ column_1: [1, 2] });
    await rendering;

    expect(drawnNodeIds()).toEqual([1, 2]);
  });

  it("draws nothing for a node table without an edge table", async () => {
    await create().nodes("graph.nodes", ["id"]).render();

    expect(requests).toHaveLength(0);
    expect(drawnNodeIds()).toEqual([]);
  });

  it("rejects when a load fails", async () => {
    const rendering = create().data("graph.out", ["a", "b"]).render();
    requests[0].fail(new Error("down"));

    await expect(rendering).rejects.toThrow("down");
    expect(graph.graphData).not.toHaveBeenCalled();
  });
});

describe("data sources", () => {
  it("loads a data table set after raw data", async () => {
    const viz = create().raw(RAW);
    const rendering = viz.data("graph.out", ["a", "b"]).render();
    requests[0].respond({ column_1: [7], column_2: [8] });
    await rendering;

    expect(drawnNodeIds()).toEqual([7, 8]);
  });

  it("loads node and edge tables set after raw data", async () => {
    const viz = create().raw(RAW);
    const rendering = viz
      .nodes("graph.nodes", ["id"])
      .edges("graph.edges", ["n1", "n2"])
      .render();
    requests[0].respond({ column_1: [1, 2] });
    requests[1].respond({ column_1: [1], column_2: [2] });
    await rendering;

    expect(requests.map((request) => request.table)).toEqual([
      "graph.nodes",
      "graph.edges",
    ]);
    expect(drawnNodeIds()).toEqual([1, 2]);
  });

  it("uses raw data set after a table", async () => {
    const viz = create().data("graph.out", ["a", "b"]);
    await viz.raw(RAW).render();

    expect(requests).toHaveLength(0);
    expect(drawnNodeIds()).toEqual(["a", "b"]);
  });

  it("uses a data table set after node and edge tables", async () => {
    const viz = create()
      .nodes("graph.nodes", ["id"])
      .edges("graph.edges", ["n1", "n2"]);
    const rendering = viz.data("graph.out", ["a", "b"]).render();
    requests[0].respond({ column_1: [5], column_2: [6] });
    await rendering;

    expect(requests.map((request) => request.table)).toEqual(["graph.out"]);
  });
});

describe("overlapping renders", () => {
  it("keeps the latest result when an older load finishes last", async () => {
    const viz = create();
    const first = viz.data("graph.old", ["a", "b"]).render();
    const second = viz.data("graph.new", ["a", "b"]).render();

    requests[1].respond({ column_1: [2], column_2: [3] });
    await second;
    requests[0].respond({ column_1: [0], column_2: [1] });
    await first;

    expect(graph.graphData).toHaveBeenCalledTimes(1);
    expect(drawnNodeIds()).toEqual([2, 3]);
  });

  it("drops an older load that finishes first", async () => {
    const viz = create();
    const first = viz.data("graph.old", ["a", "b"]).render();
    const second = viz.data("graph.new", ["a", "b"]).render();

    requests[0].respond({ column_1: [0], column_2: [1] });
    await first;
    requests[1].respond({ column_1: [2], column_2: [3] });
    await second;

    expect(graph.graphData).toHaveBeenCalledTimes(1);
    expect(drawnNodeIds()).toEqual([2, 3]);
  });

  it("ignores a failure from a superseded load", async () => {
    const viz = create();
    const first = viz.data("graph.old", ["a", "b"]).render();
    const second = viz.data("graph.new", ["a", "b"]).render();

    requests[0].fail(new Error("aborted"));
    requests[1].respond({ column_1: [2], column_2: [3] });

    await expect(first).resolves.toBeUndefined();
    await second;
    expect(drawnNodeIds()).toEqual([2, 3]);
  });
});

describe("destroy", () => {
  it("destroys the graph and stops listening for resizes", () => {
    const viz = create();
    graph.width.mockClear();

    viz.destroy();
    window.dispatchEvent(new Event("resize"));

    expect(graph._destructor).toHaveBeenCalledTimes(1);
    expect(graph.width).not.toHaveBeenCalled();
  });

  it("frees WebGL resources and removes the graph's elements", () => {
    const viz = create();
    const elem = document.getElementById("graph");
    elem.appendChild(document.createElement("canvas"));

    viz.destroy();

    expect(graph.renderer().dispose).toHaveBeenCalled();
    expect(graph.renderer().forceContextLoss).toHaveBeenCalled();
    expect(graph.controls().dispose).toHaveBeenCalled();
    expect(graph.postProcessingComposer().dispose).toHaveBeenCalled();
    expect(elem.childElementCount).toBe(0);
  });

  it("can be called more than once", () => {
    const viz = create();
    viz.destroy();
    viz.destroy();

    expect(graph._destructor).toHaveBeenCalledTimes(1);
    expect(graph.renderer().dispose).toHaveBeenCalledTimes(1);
  });

  it("stops graph() and enableBloom() from touching the graph", () => {
    const viz = create();
    const configure = vi.fn();
    viz.destroy();

    viz.graph(configure).enableBloom();

    expect(configure).not.toHaveBeenCalled();
    expect(graph.postProcessingComposer().addPass).not.toHaveBeenCalled();
  });

  it("ignores a load that fails after destroy", async () => {
    const viz = create();
    const rendering = viz.data("graph.out", ["a", "b"]).render();

    viz.destroy();
    requests[0].fail(new Error("aborted"));

    await expect(rendering).resolves.toBeUndefined();
  });

  it("does not draw a load that finishes after destroy", async () => {
    const viz = create();
    const rendering = viz.data("graph.out", ["a", "b"]).render();

    viz.destroy();
    requests[0].respond({ column_1: [1], column_2: [2] });
    await rendering;

    expect(graph.graphData).not.toHaveBeenCalled();
    expect(graph.resumeAnimation).not.toHaveBeenCalled();
  });

  it("makes later renders a no-op", async () => {
    const viz = create().data("graph.out", ["a", "b"]);
    viz.destroy();
    await viz.render();

    expect(requests).toHaveLength(0);
    expect(graph.graphData).not.toHaveBeenCalled();
  });
});

describe("configuration", () => {
  it("passes the graph instance to graph()", () => {
    const configure = vi.fn();
    create().graph(configure);
    expect(configure).toHaveBeenCalledWith(graph);
  });

  it("requests 1000 rows by default", () => {
    create().data("graph.out", ["a", "b"]).render();
    expect(requests[0].limit).toBe(1000);
  });

  it("requests the configured number of rows", () => {
    create().limit(50).data("graph.out", ["a", "b"]).render();
    expect(requests[0].limit).toBe(50);
  });

  it("applies the configured curvature to parallel edges", async () => {
    await create()
      .curvature(0.5)
      .raw({
        nodes: RAW.nodes,
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "a" },
        ],
      })
      .render();

    expect(drawn().links.map((link: any) => link.curvature)).toEqual([
      0.5, 0.5,
    ]);
  });

  it("resizes the graph to its element when the window resizes", () => {
    create();
    graph.width.mockClear();
    window.dispatchEvent(new Event("resize"));
    expect(graph.width).toHaveBeenCalled();
  });

  it("adds a bloom pass", () => {
    create().enableBloom();
    expect(graph.postProcessingComposer().addPass).toHaveBeenCalledTimes(1);
  });
});

describe("missing nodes", () => {
  it("adds nodes that appear only in edges, once each", async () => {
    await create()
      .raw({
        nodes: [{ id: "a" }],
        edges: [
          { source: "a", target: "x" },
          { source: "x", target: "y" },
          { source: "y", target: "a" },
        ],
      })
      .render();

    expect(drawnNodeIds()).toEqual(["a", "x", "y"]);
  });

  it("handles edges whose ends are node objects", async () => {
    // 3d-force-graph replaces edge ends with node objects after drawing.
    await create()
      .raw({
        nodes: [{ id: "a" }],
        edges: [{ source: { id: "a" }, target: { id: "z" } }],
      })
      .render();

    expect(drawnNodeIds()).toEqual(["a", "z"]);
  });
});

describe("table columns", () => {
  const loadTables = async (nodeColumns: string[], edgeColumns: string[]) => {
    const rendering = create()
      .nodes("graph.nodes", nodeColumns)
      .edges("graph.edges", edgeColumns)
      .render();
    return { rendering, nodes: requests[0], edges: requests[1] };
  };

  it("reads node names from a 2-column node table", async () => {
    const { rendering, nodes, edges } = await loadTables(
      ["id", "name"],
      ["n1", "n2"]
    );
    nodes.respond({ column_1: [1], column_2: ["one"] });
    edges.respond({ column_1: [], column_2: [] });
    await rendering;

    expect(nodes.columns).toEqual(["id", "name"]);
    expect(drawn().nodes).toEqual([{ id: 1, name: "one" }]);
  });

  it("reads node names and labels from a 3-column node table", async () => {
    const { rendering, nodes, edges } = await loadTables(
      ["id", "name", "label"],
      ["n1", "n2"]
    );
    nodes.respond({ column_1: [1], column_2: ["one"], column_3: ["L1"] });
    edges.respond({ column_1: [], column_2: [] });
    await rendering;

    expect(drawn().nodes).toEqual([{ id: 1, name: "one", label: "L1" }]);
  });

  it("reads edge labels from a 3-column edge table", async () => {
    const { rendering, nodes, edges } = await loadTables(
      ["id"],
      ["n1", "n2", "label"]
    );
    nodes.respond({ column_1: [1, 2] });
    edges.respond({ column_1: [2], column_2: [1], column_3: ["knows"] });
    await rendering;

    expect(drawn().links).toEqual([{ source: 2, target: 1, label: "knows" }]);
  });

  it("reads edge labels from a 3-column data table", async () => {
    const rendering = create()
      .data("graph.out", ["n1", "n2", "label"])
      .render();
    requests[0].respond({ column_1: [2], column_2: [1], column_3: ["knows"] });
    await rendering;

    expect(drawn().links).toEqual([{ source: 2, target: 1, label: "knows" }]);
  });

  it("rejects when the node table fails to load", async () => {
    const { rendering, nodes } = await loadTables(["id"], ["n1", "n2"]);
    nodes.fail(new Error("no such table"));
    await expect(rendering).rejects.toThrow("no such table");
  });

  it("rejects when the edge table fails to load", async () => {
    const { rendering, nodes, edges } = await loadTables(["id"], ["n1", "n2"]);
    nodes.respond({ column_1: [1] });
    edges.fail(new Error("no such table"));
    await expect(rendering).rejects.toThrow("no such table");
  });

  it("rejects a data table with fewer than 2 columns", async () => {
    const rendering = create().data("graph.out", ["n1"]).render();

    await expect(rendering).rejects.toThrow(
      "data() needs at least 2 columns"
    );
    expect(requests).toHaveLength(0);
  });
});
