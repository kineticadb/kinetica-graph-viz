declare class KineticaGraphViz {
    private _gpudb;
    private _elem;
    private _graph;
    private _nodesTable;
    private _nodesTableColumns;
    private _edgesTable;
    private _edgesTableColumns;
    private _dataTable;
    private _dataTableColumns;
    private _dataGroup;
    private _limit;
    constructor(elemId: string);
    graph: (fn: any) => KineticaGraphViz;
    connect: (url: string, options: any) => KineticaGraphViz;
    limit: (limit: number) => KineticaGraphViz;
    nodes: (table: string, columns: string[]) => KineticaGraphViz;
    private _loadNodes;
    edges: (table: string, columns: string[]) => KineticaGraphViz;
    private _loadEdges;
    data: (table: string, columns: string[], group?: string) => this;
    private _loadData;
    enableBloom: () => this;
    render: () => Promise<void>;
}
export default KineticaGraphViz;
