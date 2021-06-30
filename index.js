import * as d3 from "d3";

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
        data: dataNodes.get(domain.data),
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
        data,
      },
    };
    nodes.push(node);
  }

  nodes.push({
    type: "render",
    params: {
      markNodes: nodes.filter((n) => n.type === "mark"),
      widthNode,
      heightNode,
    },
  });

  return nodes;
}

function render(specification, element) {
  const dagNodes = parse(specification);
  const {
    params: { markNodes, widthNode, heightNode },
  } = dagNodes.find((node) => node.type === "render");
  const svg = d3
    .create("svg")
    .attr("viewBox", `0 0 ${widthNode.value} ${heightNode.value}`);
  for (const { params } of markNodes) {
    const { type: markType, data, attributes } = params;
    for (const row of data.params.values) {
      const markItem = svg.append(markType);
      for (const { name, value } of attributes) {
        let valueForAttr;
        if (value.type === "operator") {
          valueForAttr = value.value;
        } else if (value.type === "data_manipulation") {
          const { field, operation, scale: scaleNode } = value.params;
          if (operation === "call_scale") {
            const datum = row[field];
            const scale = scaleForScaleNode(scaleNode);
            valueForAttr = scale(datum);
          }
        }
        markItem.attr(name, valueForAttr);
      }
    }
  }
  element.append(svg.node());
}

function scaleForScaleNode({
  params: { type: scaleType, domain: domainNode, range: rangeNode },
}) {
  if (scaleType !== "linear") throw "Only linear scales are supported";

  const domain = resolveNodeValue(domainNode);
  const range = resolveNodeValue(rangeNode);
  return d3.scaleLinear().domain(domain).range([0, range]);
}

function resolveNodeValue({ type: nodeType, value, params }) {
  if (nodeType === "data_manipulation") {
    const { operation, field, data } = params;
    switch (operation) {
      case "extent":
        return d3.extent(data.params.values, (d) => d[field]);
        break;
      default:
        throw `Can't handle data manipulation operation: ${operation}`;
    }
  } else if (nodeType === "operator") {
    return value;
  } else {
    throw `Can't handle ${nodeType}`;
  }
}

render(example, document.getElementById("chart"));
