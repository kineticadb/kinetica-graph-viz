<h2>Kinetica Graph Visualization Library</h2>
Visualize graph data fom a Kinetica database

## Installation

```
npm install --save @kinetica/kinetica-graph-viz
```

## Usage

### npm

```javascript
import KineticaGraphViz from "@kinetica/kinetica-graph-viz";
const kGraphViz = new KineticaGraphViz("my_graph");

kGraphViz
  .connect("http://127.0.0.1:9191", {
    username: "admin",
    password: "password",
  })
  .nodes("graph.social_ids_nodes", ["id", "name"])
  .edges("graph.social_ids_edges", ["node1", "node2"])
  .limit(1000)
  .graph((graph) => {
    graph
      .cooldownTicks(50)
      .backgroundColor("#00000000")
      .nodeVal(() => Math.random() * 15)
      .nodeLabel((node) => `Node ${node.id}`)
      .nodeColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkWidth(2);
  })
  .render();
```

### self-host/cdn

```javascript
<script src="build/index.js"></script>;

const KineticaGraphViz = window.KineticaGraphViz.default;
const kGraphViz = new KineticaGraphViz("my_graph");

kGraphViz
  .connect("http://127.0.0.1:9191", {
    username: "admin",
    password: "password",
  })
  .data("graph.nodes_edges", ["EDGE_NODE1_ID", "EDGE_NODE2_ID"])
  .limit(1000)
  .graph((graph) => {
    graph
      .cooldownTicks(50)
      .backgroundColor("#00000000")
      .nodeVal(() => Math.random() * 15)
      .nodeLabel((node) => `Node ${node.id}`)
      .nodeColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkColor(() => (Math.random() > 0.5 ? "#4c00b0" : "#FF00FF"))
      .linkWidth(2);
  })
  .render();
```

### Updating and cleaning up

`nodes()`/`edges()`, `data()` and `raw()` each replace the previously set data
source, and calling `render()` again redraws with the latest one. If a newer
`render()` starts before an earlier load finishes, the earlier result (or
error) is discarded. Node and edge tables are loaded in parallel.

Call `destroy()` when the graph is removed from the page. It stops the
animation, removes the graph's elements and its window resize listener, and
releases its WebGL context. Later calls on the instance do nothing.

```javascript
kGraphViz.destroy();
```

## Development

```
npm install
npm test        # unit tests (Vitest)
npm run build
```
