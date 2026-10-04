import { describe, expect, it } from "vitest";
import { detailWords } from "../../convex/lib/askStory";

describe("detailWords: the listener's words, minus how they asked", () => {
  it("'discuss' is a way of asking, and a generic place word drops when a name is left (live miss: El Tsunami)", () => {
    expect(detailWords("what did they discuss about tsunami restaurant")).toBe("tsunami");
  });
  it("other ways of asking drop too", () => {
    expect(detailWords("what did Ann think of the stromboli")).toBe("stromboli");
    expect(detailWords("tell me more details about the burek")).toBe("burek");
    expect(detailWords("how did they review Bread House")).toBe("bread house");
  });
  it("a generic place word stays when it is all the listener said", () => {
    expect(detailWords("what restaurants did they talk about")).toBe("restaurants");
  });
});
