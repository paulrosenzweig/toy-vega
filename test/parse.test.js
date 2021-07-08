import { parse } from "../index.js";

describe("parse", () => {
  it("should parse a minimal specification", () => {
    const nodes = parse({ width: 200, height: 200 });
    expect(nodes.length).toEqual(3); // width, height, render
    expect(nodes.map((n) => n.deps())).toEqual([[], [], [nodes[0], nodes[1]]]);
  });
});
