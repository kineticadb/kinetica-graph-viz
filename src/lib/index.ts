import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";
import GPUdb from "../gpudb/GPUdb";
import { reorder, applyCurvature } from "./helpers";

class KineticaGraphViz {
  private _gpudb: GPUdb;
  private _elem: HTMLElement;
  private _graph: any;
  private _nodesTable: string;
  private _nodesTableColumns: string[];
  private _edgesTable: string;
  private _edgesTableColumns: string[];
  private _dataTable: string;
  private _dataTableColumns: string[];
  private _rawNodes: any[];
  private _rawEdges: any[];
  // The data source set most recently; render() draws only this one.
  private _source: "raw" | "tables" | "data";
  private _limit = 1000;
  private _curvature = 1.0;
  // Identifies the latest render() call; older loads are discarded.
  private _renderId = 0;
  private _destroyed = false;

  constructor(elemId: string, configOptions: any = {}) {
    this._elem = document.getElementById(elemId);
    this._graph = ForceGraph3D(configOptions)(this._elem);

    window.addEventListener("resize", this._resizeCanvas);

    this._resizeCanvas();

    this._graph.pauseAnimation();
    this._graph.linkCurvature("curvature");
    this._graph.linkCurveRotation("rotation");
  }

  private _resizeCanvas = () => {
    this._graph.width(this._elem.clientWidth);
    this._graph.height(this._elem.clientHeight);
  };

  graph = (fn: any): KineticaGraphViz => {
    if (!this._destroyed) {
      fn(this._graph);
    }
    return this;
  };

  connect = (url: string, options: any): KineticaGraphViz => {
    this._gpudb = new GPUdb(url, options);
    return this;
  };

  limit = (limit: number): KineticaGraphViz => {
    this._limit = limit;
    return this;
  };

  curvature = (curvature: number): KineticaGraphViz => {
    this._curvature = curvature;
    return this;
  };

  nodes = (table: string, columns: string[]): KineticaGraphViz => {
    this._source = "tables";
    this._nodesTable = table;
    this._nodesTableColumns = columns;
    return this;
  };

  private _addMissingNodes = (nodes: any[], edges: any[]): any[] => {
    const missing = edges.reduce((acc: any[], cur: any) => {
      const { source, target } = cur;
      if (
        !nodes.some((node) => node.id === source || node.id === source.id) &&
        !acc.some((node) => node.id === source || node.id === source.id)
      ) {
        acc.push({ id: source.id ?? source });
      }
      if (
        !nodes.some((node) => node.id === target || node.id === target.id) &&
        !acc.some((node) => node.id === target || node.id === target.id)
      ) {
        acc.push({ id: target.id ?? target });
      }
      return acc;
    }, []);
    return nodes.concat(missing);
  };

  private _loadNodes = async (): Promise<any> => {
    return new Promise((resolve, reject) => {
      this._gpudb.get_records_by_column(
        this._nodesTable,
        this._nodesTableColumns,
        0,
        this._limit,
        {},
        (error: any, resp: any) => {
          const nodes = [];
          if (error) {
            reject(error);
          } else {
            if (this._nodesTableColumns.length == 1) {
              for (let i = 0; i < resp.data.column_1.length; i++) {
                nodes.push({
                  id: resp.data.column_1[i],
                });
              }
            } else if (this._nodesTableColumns.length == 2) {
              for (let i = 0; i < resp.data.column_1.length; i++) {
                nodes.push({
                  id: resp.data.column_1[i],
                  name: resp.data.column_2[i],
                });
              }
            } else if (this._nodesTableColumns.length == 3) {
              for (let i = 0; i < resp.data.column_1.length; i++) {
                nodes.push({
                  id: resp.data.column_1[i],
                  name: resp.data.column_2[i],
                  label: resp.data.column_3[i],
                });
              }
            }
            resolve(nodes);
          }
        }
      );
    });
  };

  edges = (table: string, columns: string[]): KineticaGraphViz => {
    this._source = "tables";
    this._edgesTable = table;
    this._edgesTableColumns = columns;
    return this;
  };

  private _loadEdges = async (): Promise<any> => {
    return new Promise((resolve, reject) => {
      this._gpudb.get_records_by_column(
        this._edgesTable,
        this._edgesTableColumns,
        0,
        this._limit,
        {},
        (error: any, resp: any) => {
          const edges = [];
          if (error) {
            reject(error);
          } else {
            if (this._edgesTableColumns.length == 2) {
              for (let i = 0; i < resp.data.column_1.length; i++) {
                edges.push({
                  source: resp.data.column_1[i],
                  target: resp.data.column_2[i],
                });
              }
            } else if (this._edgesTableColumns.length == 3) {
              for (let i = 0; i < resp.data.column_1.length; i++) {
                edges.push({
                  source: resp.data.column_1[i],
                  target: resp.data.column_2[i],
                  label: resp.data.column_3[i],
                });
              }
            }
            resolve(edges);
          }
        }
      );
    });
  };

  data = (table: string, columns: string[]) => {
    this._source = "data";
    this._dataTable = table;
    this._dataTableColumns = columns;
    return this;
  };

  raw = (data: any) => {
    const { nodes = [], edges = [] } = data;
    this._source = "raw";
    this._rawNodes = nodes;
    this._rawEdges = edges;
    return this;
  };

  private _loadData = async (): Promise<any> => {
    return new Promise((resolve, reject) => {
      const nodes_idx = new Set();
      const links: any[] = [];

      if (this._dataTableColumns.length < 2) {
        reject(new Error("data() needs at least 2 columns"));
        return;
      }

      this._gpudb.get_records_by_column(
        this._dataTable,
        this._dataTableColumns,
        0,
        this._limit,
        {},
        (error: any, resp: any) => {
          if (error) {
            reject(error);
          } else {
            for (let i = 0; i < resp.data.column_1.length; i++) {
              nodes_idx.add(resp.data.column_1[i]);
              nodes_idx.add(resp.data.column_2[i]);
              if (this._dataTableColumns.length == 2) {
                links.push({
                  source: resp.data.column_1[i],
                  target: resp.data.column_2[i],
                });
              } else if (this._dataTableColumns.length == 3) {
                links.push({
                  source: resp.data.column_1[i],
                  target: resp.data.column_2[i],
                  label: resp.data.column_3[i],
                });
              }
            }

            const nodes = Array.from(nodes_idx).map((id) => ({
              id,
            }));

            resolve({ nodes, links });
          }
        }
      );
    });
  };

  enableBloom = () => {
    if (this._destroyed) {
      return this;
    }
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this._elem.clientWidth, this._elem.clientHeight),
      3,
      2,
      0.1
    );
    this._graph.postProcessingComposer().addPass(bloomPass);
    return this;
  };

  // Stops rendering, removes the graph's elements and listeners, and frees
  // its WebGL context. The instance cannot be used again afterwards.
  destroy = () => {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    window.removeEventListener("resize", this._resizeCanvas);
    this._graph._destructor();
    this._graph.controls().dispose();
    this._graph.postProcessingComposer().dispose();
    const renderer = this._graph.renderer();
    renderer.dispose();
    renderer.forceContextLoss();
    this._elem.replaceChildren();
  };

  private _load = async (): Promise<{ nodes: any[]; links: any[] }> => {
    if (this._source === "raw") {
      return { nodes: this._rawNodes, links: this._rawEdges };
    }
    if (this._source === "tables" && this._nodesTable && this._edgesTable) {
      const [nodes, links] = await Promise.all([
        this._loadNodes(),
        this._loadEdges(),
      ]);
      return { nodes, links };
    }
    if (this._source === "data") {
      return this._loadData();
    }
    return { nodes: [], links: [] };
  };

  render = async () => {
    if (this._destroyed) {
      return;
    }
    const renderId = ++this._renderId;
    // False once a newer render() starts or the graph is destroyed.
    const isCurrent = () => renderId === this._renderId && !this._destroyed;

    let data;
    try {
      data = await this._load();
    } catch (error) {
      if (isCurrent()) {
        throw error;
      }
      return;
    }
    if (!isCurrent()) {
      return;
    }

    const { nodes, links } = data;

    const fullNodes = this._addMissingNodes(nodes, links);
    this._graph
      .graphData({
        nodes: fullNodes,
        links: applyCurvature(reorder(links), this._curvature),
      })
      .resumeAnimation();
  };
}

export default KineticaGraphViz;
