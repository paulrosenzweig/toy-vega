import * as d3 from "d3";

import example from "./simple-example.json";

export class Node {
  static isNode(n) {
    return n instanceof Node;
  }

  constructor(type, options = {}) {
    this.type = type;
    this.options = options;
  }

  deps() {
    function _deps(o) {
      if (Node.isNode(o)) {
        return [o];
      }
      if (Array.isArray(o)) {
        return o.flatMap(_deps);
      }
      if (typeof o === "object" && o !== null) {
        return Object.values(o).flatMap(_deps);
      }
      return [];
    }
    return Object.values(this.options).flatMap(_deps);
  }
}

export function parse(specification) {
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

  const dataNodes = new Map();
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
      nodes.push(node);

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

export function downstreamNodes(node, allNodes) {
  const foundNodes = [node];
  while (true) {
    const additionalNodes = allNodes.filter(
      (n) =>
        !foundNodes.includes(n) &&
        foundNodes.some((fn) => n.deps().includes(fn))
    );
    if (additionalNodes.length === 0) break;
    foundNodes.push(...additionalNodes);
  }
  allNodes.filter((n) => n.deps().includes(node));

  return topologicalSort(foundNodes);
}

export function topologicalSort(nodes) {
  const sortedNodes = [];
  function visit(n) {
    if (n.perm) {
      return;
    }
    if (n.temp) {
      throw "There is a cycle!";
    }
    n.temp = true;

    n.deps()
      .filter((n) => nodes.includes(n))
      .forEach((n) => visit(n));
    delete n.temp;
    n.perm = true;
    sortedNodes.push(n);
  }
  while (nodes.some((n) => !n.perm)) {
    const n = nodes.find((n) => !n.perm);
    visit(n);
  }
  for (const n of sortedNodes) {
    delete n.perm;
  }
  return sortedNodes;
}

// render(example, document.getElementById("chart"));
