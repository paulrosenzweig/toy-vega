import * as d3 from "d3";

import example from "./simple-example.json";

class Node {
  constructor(type, options) {
    this.type = type;
    this.options = options;
  }

  static isNode(n) {
    return n instanceof Node;
  }
}

function parse(specification) {
  const { width, height, scales = [], marks = [], data = [] } = specification;

  const nodes = [];

  if (width == null) {
    throw "need a width";
  }
  const widthNode = new Node("operator", { value: width });
  nodes.push(widthNode);

  if (height == null) {
    throw "need a height";
  }
  const heightNode = new Node("operator", { value: height });

  nodes.push(heightNode);

  dataNodes = new Map();
  for (const dataset of data) {
    const { name, values } = dataset;
    const node = new Node("data", { name, values });
    nodes.push(node);
    dataNodes.set(name, node);
  }

  const scaleNodes = new Map();
  for (const scale of scales) {
    const {
      name,
      type,
      domain: { field, data: dataName },
      range,
    } = scale;

    const data = dataNodes.get(dataName);
    const domainNode =
      type === "band"
        ? new Node("data_manipulation", {
            operation: "get_values",
            field,
            data,
          })
        : new Node("data_manipulation", { operation: "extent", field, data });

    const dimensionNode =
      range === "width" ? widthNode : range === "height" ? heightNode : null;
    if (dimensionNode == null) {
      throw `A scale's range needs to be "height" or "width"`;
    }

    const rangeNode = [dimensionNode, 0];

    const node = new Node("scale", {
      type,
      domain: domainNode,
      range: rangeNode,
    });
    scaleNodes.set(name, node);
    nodes.push(node);
  }

  for (const mark of marks) {
    const { type, from, encode } = mark;

    const data = dataNodes.get(from.data);

    const attributes = Object.entries(encode).map(([name, value]) => {
      let node;
      if (value.scale !== undefined) {
        node = new Node("data_manipulation", {
          operation: "call_scale",
          ...(value.value !== undefined
            ? { value: value.value }
            : value.band !== undefined
            ? { band: value.band }
            : { field: value.field }),
          data,
          scale: scaleNodes.get(value.scale),
        });
      } else {
        node = new Node("operator", {
          value: value.value,
        });
      }

      return { name, value: node };
    });

    const node = new Node("mark", { type, attributes, data });

    nodes.push(node);
  }

  nodes.push(
    new Node("render", {
      markNodes: nodes.filter((n) => n.type === "mark"),
      widthNode,
      heightNode,
    })
  );

  return nodes;
}

function render(specification, element) {
  const dagNodes = parse(specification);
  const { markNodes, widthNode, heightNode } = dagNodes.find(
    (node) => node.type === "render"
  ).options;
  const svg = d3
    .create("svg")
    .attr(
      "viewBox",
      `0 0 ${resolveNodeValue(widthNode)} ${resolveNodeValue(heightNode)}`
    );
  for (const { options } of markNodes) {
    const { type: markType, data, attributes } = options;
    for (const row of data.options.values) {
      const markItem = svg.append(markType);
      for (const { name, value } of attributes) {
        const valueForAttr = resolveNodeValue(value, { row });
        if (name === "y2") {
          const { value: yValueNode } = attributes.find((a) => a.name === "y");
          const yValue = resolveNodeValue(yValueNode, { row });
          const val = valueForAttr - yValue;
          console.log({ attributes, valueForAttr, yValue, val });
          markItem.attr("height", val);
        } else {
          markItem.attr(name, valueForAttr);
        }
      }
    }
  }
  element.append(svg.node());
}

function scaleForScaleNode({
  options: { type: scaleType, domain: domainNode, range: rangeNode },
}) {
  if (scaleType !== "linear" && scaleType !== "band")
    throw "Only linear and band scales are supported";

  const domain = resolveNodeValue(domainNode);
  const range = resolveNodeValue(rangeNode);
  const scale =
    scaleType === "band" ? d3.scaleBand().padding(0.1) : d3.scaleLinear();
  return scale.domain(domain).range(range);
}

function resolveNodeValue(node, context) {
  if (Array.isArray(node)) {
    return node.map((n) => resolveNodeValue(n, context));
  }
  if (!Node.isNode(node)) {
    return node;
  }

  const { type: nodeType, options } = node;
  if (nodeType === "data_manipulation") {
    const { operation, field, data } = options;
    switch (operation) {
      case "get_values":
        return data.options.values.map((d) => d[field]);
        break;
      case "extent":
        return d3.extent(data.options.values, (d) => d[field]);
        break;
      case "call_scale":
        const scale = scaleForScaleNode(options.scale);
        if (options.band !== undefined) {
          return scale.bandwidth();
        }
        const datum =
          options.value !== undefined ? options.value : context.row[field];
        return scale(datum);
        break;
      default:
        throw `Can't handle data manipulation operation: ${operation}`;
    }
  }
  if (nodeType === "operator") {
    return options.value;
  }
  throw `Can't handle ${nodeType}`;
}

render(example, document.getElementById("chart"));
