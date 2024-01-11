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
    { source: "2", target: "3" },
    { source: "2", target: "4" },
    { source: "4", target: "5" },
  ],
};

kgraph
  .connect("http://127.0.0.1:9191", {
    username: "admin",
    password: "password",
  })
  // .data("ki_home.kgraph_query", ["QUERY_NODE1_NAME", "QUERY_NODE2_NAME"])
  .raw(raw)
  .limit(1000)
  .graph((graph: any) => {
    graph
      .cooldownTicks(50)
      .backgroundColor("#00000000")
      .nodeVal(() => Math.random() * 15)
      .nodeLabel((node: any) => `Node ${node.id}`)
      .nodeColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkWidth(2);
  })
  .render();
