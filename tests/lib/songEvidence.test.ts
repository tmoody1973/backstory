import { describe, expect, it } from "vitest";
import { checkSong } from "../../convex/lib/song";
import { articleParagraphs } from "../../convex/lib/article";
import fixture from "../fixtures/cds-premiere-glitzy.json";

const text = articleParagraphs(fixture as never).join(" ");

describe("checkSong: every field must be in the article", () => {
  it("keeps what the Glitzy premiere says and drops what it doesn't", () => {
    expect(checkSong({
      artist: "Glitzy", title: "Effort", album: "Say Sorry / You're Right", releaseDate: "2026-10-23",
      credits: [{ role: "recording and mixing", name: "Shane Hochstetler" }, { role: "mastering", name: "Carl Saff" }, { role: "producer", name: "Invented Person" }],
      releaseShow: { venue: "Sugar Maple", date: "2026-10-23" }, setList: null,
    }, text)).toEqual({
      artist: "Glitzy", title: "Effort", album: "Say Sorry / You're Right", releaseDate: "2026-10-23",
      credits: [{ role: "recording and mixing", name: "Shane Hochstetler" }, { role: "mastering", name: "Carl Saff" }],
      releaseShow: { venue: "Sugar Maple", date: "2026-10-23" },
    });
  });
  it("drops an invented album and a date the article never gives", () => {
    const out = checkSong({ artist: "Glitzy", title: "Effort", album: "Invented", releaseDate: "2026-11-05", credits: [], releaseShow: null, setList: null }, text);
    expect(out).toEqual({ artist: "Glitzy", title: "Effort", credits: [] });
  });
  it("no record without an artist named in the article", () => {
    expect(checkSong({ artist: "Somebody Else", title: "Effort", credits: [], releaseShow: null, setList: null }, text)).toBeNull();
    expect(checkSong(null, text)).toBeNull();
  });
  it("set list keeps only songs the article names", () => {
    const set = "Studio MKE set list Boxes & Squares Move Don't Count Yourself Out";
    expect(checkSong({ artist: "Tank & The Bangas", credits: [], releaseShow: null, setList: ["Boxes & Squares", "Move", "Made Up"] }, `Tank & The Bangas ${set}`))
      .toEqual({ artist: "Tank & The Bangas", credits: [], setList: ["Boxes & Squares", "Move"] });
  });
});
