import assert from "assert";
import { formatMarkdownTable, formatDuration, parseTasklist } from "../src/util";

describe("util", () => {
    describe("formatMarkdownTable", () => {
        it("should correctly output a table", () => {
            const table = Array(2).fill(0).map((_, i) => ({
                a: "String",
                b: i
            }));

            assert.equal(
                "| a      | b |\n" +
                "|--------|---|\n" +
                "| String | 0 |\n" +
                "| String | 1 |",
                formatMarkdownTable(table)
            );
        });
    });

    describe("formatDuration", () => {
        it("should correctly format a duration", () => {
            assert.equal("1 hour and 5 minutes", formatDuration(1 + (5/60)));
        });
    });

    describe("parseTasklist", () => {
        it("should parse a valid tasklist", () => {
            assert.deepEqual(parseTasklist("https://1486461376533.teamwork.com/index.cfm#tasklists/457357"), {
                installation: "1486461376533",
                tasklist: 457357
            })
        });
    });
});