import { describe, expect, it } from "vitest";
import { pickDetails } from "../../convex/lib/placeDetails";

const item = (title: string, distance: number, extra = {}) => ({
  Title: title, Distance: distance,
  Contacts: { Phones: [{ Value: "+14145551234" }], Websites: [{ Value: "https://breadhouse.example" }] },
  OpeningHours: [{ Display: ["Tue-Sun: 11:00 - 21:00"] }],
  ...extra,
});

describe("pickDetails", () => {
  it("takes phone, website and hours from the result that is this place (same name, at the pin)", () => {
    expect(pickDetails("Bread House", [item("Starbucks", 20), item("Bread House", 35)])).toEqual({
      phone: "+14145551234", website: "https://breadhouse.example", openingHours: "Tue-Sun: 11:00 - 21:00",
    });
  });
  it("nothing when no result shares the name or the match is far from the pin", () => {
    expect(pickDetails("Bread House", [item("Starbucks", 10)])).toBeNull();
    expect(pickDetails("Bread House", [item("Bread House", 2500)])).toBeNull();
  });
  it("only http(s) websites; missing pieces stay empty", () => {
    expect(pickDetails("Bread House", [item("Bread House", 10, { Contacts: { Websites: [{ Value: "javascript:alert(1)" }] }, OpeningHours: undefined })]))
      .toEqual({ phone: undefined, website: undefined, openingHours: undefined });
  });
});
