declare class GPUdb {
  private Type;
  private Column;
  private FileHandler;
  private RingList;
  constructor(url: string, options: any);
  get_records_by_column: (
    table_name: string,
    column_names: string[],
    offset: number,
    limit: number,
    options: any,
    callback: (error: any, resp: any) => any
  ) => any;
}
export default GPUdb;
