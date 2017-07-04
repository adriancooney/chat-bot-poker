import assert from "assert";
import {
    formatMarkdownTable,
    formatDuration,
    parseTasklist,
    formatList
} from "../src/util";

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
                id: 457357
            });

            assert.deepEqual(parseTasklist("https://1486461376533.teamwork.com/index.cfm#/tasklists/457357"), {
                installation: "1486461376533",
                id: 457357
            });

            assert.deepEqual(parseTasklist("https://1486461376533.teamwork.com/tasklists/457357"), {
                installation: "1486461376533",
                id: 457357
            });
        });
    });

    describe("formatList", () => {
        it("should format a list of length one", () => {
            assert.equal(formatList(["foo"]), "foo");
        });

        it("should format list of length two", () => {
           assert.equal(formatList(["foo", "bar"]), "foo and bar");
        });

        it("should format list of length greater than two", () => {
           assert.equal(formatList(["foo", "bar", "boot"]), "foo, bar and boot");
        });
    });
});