import KineticaGraphViz from "../lib";
import "./style.css";

const body = document.getElementsByTagName("body");

const title = document.createElement("h2");
title.id = "title";
title.innerHTML = "Kinetica Graph Viz Demo";
body[0]?.appendChild(title);

const elem = document.createElement("div");
elem.id = "my_graph";
body[0]?.appendChild(elem);

const kgraph = new KineticaGraphViz("my_graph", {});

const raw = {
  nodes: [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }],
  edges: [
    { source: "1", target: "2" },
    { source: "2", target: "1" },
    { source: "1", target: "2" },
    { source: "2", target: "1" },
    { source: "1", target: "2" },
    { source: "2", target: "3" },
    { source: "3", target: "2" },
    { source: "2", target: "3" },
    { source: "2", target: "4" },
    { source: "4", target: "5" },
  ],
};

const getEdgeKey = (edge: any) => {
  const { source, target } = edge;
  return `${source}_${target}`;
};

const reorder = (edges: any[]) => {
  return edges.map((edge: any) => {
    const { source, target } = edge;
    return source > target
      ? edge
      : {
          source: target,
          target: source,
        };
  });
};

const applyCurvature = (edges: any[]) => {
  const counts = edges.reduce((acc: any, cur: any) => {
    const key = getEdgeKey(cur);
    acc[key] = acc[key]
      ? {
          ...acc[key],
          total: acc[key].total + 1,
        }
      : {
          total: 1,
          index: 0,
        };
    return acc;
  }, {});

  const updates = edges.map((edge: any) => {
    const key = getEdgeKey(edge);
    const count = counts[key];
    if (count.total > 1) {
      counts[key] = {
        ...counts[key],
        index: count.index + 1,
      };
      return {
        ...edge,
        curvature: 0.9,
        rotation: ((2 * Math.PI) / count.total) * count.index,
      };
    }
    return edge;
  });
  return updates;
};

kgraph
  .connect("http://127.0.0.1:9191", {
    username: "admin",
    password: "password",
  })
  // .data("ki_home.kgraph_query", ["QUERY_NODE1_NAME", "QUERY_NODE2_NAME"])
  .raw({
    ...raw,
    edges: applyCurvature(reorder(raw.edges)),
  })
  .limit(1000)
  .graph((graph: any) => {
    graph
      .cooldownTicks(50)
      .backgroundColor("#ffffff")
      .nodeVal(() => Math.random() * 15)
      .nodeLabel((node: any) => `Node ${node.id}`)
      .nodeColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkWidth(1);
  })
  .render();
