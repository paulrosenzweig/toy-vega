import example from "./simple-example.json";

function parse(specification) {
  const { width, height, scales = [], marks = [], data = [] } = specification;

  const nodes = [];

  if (width == null) {
    throw "need a width";
  }
  const widthNode = {
    type: "operator",
    value: width,
  };
  nodes.push(widthNode);

  if (height == null) {
    throw "need a height";
  }
  const heightNode = {
    type: "operator",
    value: height,
  };
  nodes.push(heightNode);

  dataNodes = new Map();
  for (const dataset of data) {
    const { name, values } = dataset;
    const node = {
      type: "data",
      params: { name, values },
    };
    nodes.push(node);
    dataNodes.set(name, node);
  }

  const scaleNodes = new Map();
  for (const scale of scales) {
    const { name, type, domain, range } = scale;
    const domainNode = {
      type: "data_manipulation",
      params: {
        operation: "extent",
        field: domain.field,
        data: dataNodes[domain.data],
      },
    };

    const rangeNode =
      range === "width" ? widthNode : range === "height" ? heightNode : null;
    if (rangeNode == null) {
      throw `A scale's range needs to be "height" or "width"`;
    }

    const node = {
      type: "scale",
      params: {
        type,
        domain: domainNode,
        range: rangeNode,
      },
    };
    scaleNodes.set(name, node);
    nodes.push(node);
  }

  for (const mark of marks) {
    const { type, from, encode } = mark;

    const data = dataNodes.get(from.data);

    const attributes = Object.entries(encode).map(([name, value]) => {
      let node;
      if (value.value !== undefined) {
        node = {
          type: "operator",
          value: value.value,
        };
      } else {
        node = {
          type: "data_manipulation",
          params: {
            operation: "call_scale",
            field: value.field,
            data,
            scale: scaleNodes.get(value.scale),
          },
        };
      }

      return { name, value: node };
    });

    const node = {
      type: "mark",
      params: {
        type,
        attributes,
      },
    };
    nodes.push(node);
  }

  nodes.push({
    type: "render",
    params: { markNodes: nodes.filter((n) => n.type === "mark") },
  });

  return nodes;
}

console.log(parse(example));
