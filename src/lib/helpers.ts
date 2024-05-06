export const getEdgeKey = (edge: any) => {
  const { source, target } = edge;
  return `${source}_${target}`;
};

export const reorder = (edges: any[]) => {
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

export const applyCurvature = (edges: any[], curvature = 1.0) => {
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
    if (count.total > 1 || edge.source === edge.target) {
      counts[key] = {
        ...counts[key],
        index: count.index + 1,
      };
      return {
        ...edge,
        curvature,
        rotation: ((2 * Math.PI) / count.total) * count.index,
      };
    }
    return edge;
  });
  return updates;
};
