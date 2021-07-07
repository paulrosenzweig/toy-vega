import { topologicalSort, downstreamNodes, Node } from "../index.js";

describe("topologicalSort", () => {
  it("should sort nodes topologically", () => {
    const n1 = new Node("1", { deps: [] });
    const n2 = new Node("2", { deps: [n1] });
    const n3 = new Node("3", { deps: [n2] });
    const nodes = [n2, n1, n3];
    expect(
      topologicalSort(nodes)
        .map((n) => n.type)
        .join()
    ).toEqual("1,2,3");
  });

  it("should sort just a sub tree", () => {
    const n1 = new Node("1", { deps: [] });
    const n2 = new Node("2", { deps: [n1] });
    const n3 = new Node("3", { deps: [n2] });
    const nodes = [n2, n3];
    expect(
      topologicalSort(nodes)
        .map((n) => n.type)
        .join()
    ).toEqual("2,3");
  });
});

describe("downstreamNodes", () => {
  it("should enumerate all downstream nodes in topological order", () => {
    const n1 = new Node("1", { deps: [] });
    const n2 = new Node("2", { deps: [n1] });
    const n3 = new Node("3", { deps: [n2] });
    const n4 = new Node("4", { deps: [n1, n3] });
    const nodes = [n4, n3, n2, n1];
    const testCases = [
      { node: n1, result: "1,2,3,4" },
      { node: n2, result: "2,3,4" },
      { node: n3, result: "3,4" },
    ];
    for (const { node, result } of testCases) {
      expect(
        downstreamNodes(node, nodes)
          .map((n) => n.type)
          .join()
      ).toEqual(result);
    }
  });
});
