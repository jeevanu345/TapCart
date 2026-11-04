import { expect, it } from "vitest";
import { parseCSV, serializeCSV } from "./api";
it("round-trips commas, quoted strings and multiline catalog descriptions", () => {
  const rows = [
    ["sku", "description"],
    ["ITEM,1", 'A "fine" cup\nwith handle'],
  ];
  expect(parseCSV(serializeCSV(rows))).toEqual(rows);
  expect(() => parseCSV('sku,name\n"unclosed')).toThrow("unclosed");
});
it("prevents spreadsheet formula execution from untrusted catalog values", () => {
  const exported = serializeCSV([['=HYPERLINK("bad")', " +CMD", "@SUM(1)", -2, "Safe"]]);
  expect(parseCSV(exported)[0]).toEqual([
    '\'=HYPERLINK("bad")',
    "' +CMD",
    "'@SUM(1)",
    "'-2",
    "Safe",
  ]);
});
