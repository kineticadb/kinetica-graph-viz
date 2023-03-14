import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";
import GPUdb from "../gpudb/GPUdb";

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
  private _dataGroup: string;
  private _limit = 1000;

  constructor(elemId: string) {
    this._elem = document.getElementById(elemId);
    this._graph = ForceGraph3D()(this._elem);

    const resizeCanvas = () => {
      this._graph.width(this._elem.clientWidth);
      this._graph.height(this._elem.clientHeight);
    };

    window.addEventListener("resize", resizeCanvas);

    resizeCanvas();

    this._graph.pauseAnimation();
  }

  graph = (fn: any): KineticaGraphViz => {
    fn(this._graph);
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

  nodes = (table: string, columns: string[]): KineticaGraphViz => {
    this._nodesTable = table;
    this._nodesTableColumns = columns;
    return this;
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
              for (let i = 0; i < resp.total_number_of_records; i++) {
                nodes.push({
                  id: resp.data.column_1[i],
                });
              }
            } else if (this._nodesTableColumns.length == 2) {
              for (let i = 0; i < resp.total_number_of_records; i++) {
                nodes.push({
                  id: resp.data.column_1[i],
                  name: resp.data.column_2[i],
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
            for (let i = 0; i < resp.total_number_of_records; i++) {
              edges.push({
                source: resp.data.column_1[i],
                target: resp.data.column_2[i],
              });
            }
            resolve(edges);
          }
        }
      );
    });
  };

  data = (table: string, columns: string[], group?: string) => {
    this._dataTable = table;
    this._dataTableColumns = columns;
    this._dataGroup = group;
    return this;
  };

  private _loadData = async (): Promise<any> => {
    return new Promise((resolve, reject) => {
      const nodes_idx = new Set();
      const links: any[] = [];

      if (this._dataTableColumns.length != 2) {
        console.error("Invalid number of column names");
      }

      const columns = this._dataGroup
        ? [...this._dataTableColumns, this._dataGroup]
        : this._dataTableColumns;

      this._gpudb.get_records_by_column(
        this._dataTable,
        columns,
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
              if (this._dataGroup) {
                links.push({
                  source: resp.data.column_1[i],
                  target: resp.data.column_2[i],
                  group: resp.data.column_3[i],
                });
              } else {
                links.push({
                  source: resp.data.column_1[i],
                  target: resp.data.column_2[i],
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
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this._elem.clientWidth, this._elem.clientHeight),
      3,
      2,
      0.1
    );
    this._graph.postProcessingComposer().addPass(bloomPass);
    return this;
  };

  render = async () => {
    let nodes: any[] = [];
    let links: any[] = [];

    if (this._nodesTable && this._edgesTable) {
      nodes = await this._loadNodes();
      links = await this._loadEdges();
    } else if (this._dataTable) {
      const { nodes: dataNodes, links: dataLinks } = await this._loadData();
      nodes = dataNodes;
      links = dataLinks;
    }

    this._graph.graphData({ nodes, links }).resumeAnimation();
  };
}

export default KineticaGraphViz;