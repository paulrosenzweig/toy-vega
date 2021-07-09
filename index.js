import * as d3 from "d3";

import example from "./simple-example.json";

export class Node {
  static isNode(n) {
    return n instanceof Node;
  }

  constructor(type, options = {}) {
    this.type = type;
    this.options = options;
    this.value = undefined;
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

  updateValue() {
    this.value = this.getValue();
  }

  getValue() {
    if (this.type === "data_manipulation") {
      const { operation, field, data } = this.options;
      switch (operation) {
        case "get_values":
          return data.options.values.map((d) => d[field]);
          break;
        case "extent":
          return d3.extent(data.options.values, (d) => d[field]);
          break;
        case "max":
          return d3.max(data.options.values, (d) => d[field]);
          break;
        case "call_scale":
          const scale = scaleForScaleNode(this.options.scale);
          if (this.options.band !== undefined) {
            return () => scale.bandwidth();
          }
          if (this.options.value !== undefined) {
            return () => scale(this.options.value);
          }
          return ({ row }) => scale(row[field]);
          break;
        default:
          throw `Can't handle data manipulation operation: ${operation}`;
      }
    }
    if (this.type === "operator") {
      return this.options.value;
    }
    if (this.type === "data") {
      return this.options.values;
    }
  }

  isScale() {
    return (
      this.type === "data_manipulation" &&
      this.options.operation === "call_scale"
    );
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
      zero = ["linear", "sqrt", "pow"].includes(type),
    } = scale;

    const data = dataNodes.get(dataName);
    let domain;
    if (type === "band") {
      domain = new Node("data_manipulation", {
        operation: "get_values",
        field,
        data,
      });
      nodes.push(domain);
    } else if (zero) {
      // this logic is wrong. it should handle negatives or spanning zero
      const node = new Node("data_manipulation", {
        operation: "max",
        field,
        data,
      });
      nodes.push(node);
      domain = [0, node];
    } else {
      domain = new Node("data_manipulation", {
        operation: "extent",
        field,
        data,
      });
      nodes.push(domain);
    }
    const dimensionNode =
      range === "width" ? widthNode : range === "height" ? heightNode : null;
    if (dimensionNode == null) {
      throw `A scale's range needs to be "height" or "width"`;
    }
    nodes.push(dimensionNode);

    const node = new Node("scale", {
      type,
      domain,
      range: [dimensionNode, 0],
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
  topologicalSort(dagNodes).forEach((n) => n.updateValue());
  const {
    markNodes,
    widthNode: { value: width },
    heightNode: { value: height },
  } = dagNodes.find((node) => node.type === "render").options;
  const svg = d3.create("svg").attr("viewBox", `0 0 ${width} ${height}`);
  for (const { options } of markNodes) {
    const { type: markType, data, attributes } = options;
    for (const row of data.value) {
      const markItem = svg.append(markType);
      for (const { name, value } of attributes) {
        const valueForAttr = resolveValue(value, { row });
        if (name === "y2") {
          const { value: yValueNode } = attributes.find((a) => a.name === "y");
          const yValue = resolveValue(yValueNode, { row });
          const val = valueForAttr - yValue;
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

  const domain = resolveValue(domainNode);
  const range = resolveValue(rangeNode);
  const scale =
    scaleType === "band" ? d3.scaleBand().padding(0.1) : d3.scaleLinear();
  return scale.domain(domain).range(range);
}

function resolveValue(node, context) {
  if (Array.isArray(node)) {
    return node.map((n) => resolveValue(n, context));
  }
  if (!Node.isNode(node)) {
    return node;
  }
  if (node.isScale()) {
    return node.value(context);
  }
  return node.value;
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

render(example, document.getElementById("chart"));
