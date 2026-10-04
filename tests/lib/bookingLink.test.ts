import { describe, expect, it } from "vitest";
import { pickBookingLink } from "../../convex/lib/bookingLink";
import { detailQueries } from "../../convex/lib/placeDetails";

describe("pickBookingLink", () => {
  it("only booking sites, preferring the page whose address names this place", () => {
    expect(pickBookingLink("Sorella", [
      "https://www.yelp.com/biz/sorella-milwaukee",
      "https://www.opentable.com/r/birch-milwaukee",
      "https://www.opentable.com/r/sorella-milwaukee",
    ])).toBe("https://www.opentable.com/r/sorella-milwaukee");
    expect(pickBookingLink("Lupi and Iris", ["https://www.exploretock.com/lupiiris"])).toBe("https://www.exploretock.com/lupiiris");
  });
  it("a booking page that doesn't name the place is still offered (an editor decides), after any that do", () => {
    expect(pickBookingLink("Peacock Lounge", ["https://www.opentable.com/r/high-stakes-by-bartolotta-milwaukee"]))
      .toBe("https://www.opentable.com/r/high-stakes-by-bartolotta-milwaukee");
  });
  it("nothing when no result is an https booking page", () => {
    expect(pickBookingLink("Bread House", ["https://www.yelp.com/biz/bread-house", "http://www.opentable.com/r/bread-house", "https://opentable.com.evil.example/r/x"])).toBeNull();
  });
  it("the restaurant's own Tock page beats a deep link into one experience", () => {
    expect(pickBookingLink("Il Ponte", [
      "https://www.exploretock.com/il-ponte-milwaukee/experience/608866/il-ponte-reservation",
      "https://www.exploretock.com/il-ponte-milwaukee",
    ])).toBe("https://www.exploretock.com/il-ponte-milwaukee");
  });
});

describe("detailQueries", () => {
  it("name alone first (an address in the text makes Amazon return the address, not the business), then name and address", () => {
    expect(detailQueries({ name: "Il Ponte", address: "814 E Mason St, Milwaukee, WI" })).toEqual(["Il Ponte", "Il Ponte, 814 E Mason St, Milwaukee, WI"]);
    expect(detailQueries({ name: "Il Ponte", address: null })).toEqual(["Il Ponte", "Il Ponte, Milwaukee, WI"]);
  });
});
