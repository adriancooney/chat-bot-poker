import assert from "assert";
import {
    formatMarkdownTable,
    formatDuration,
    formatVote,
    formatTask,
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

    describe("formatVote", () => {
        it("should correctly format the vote", () => {
            assert.equal("1 hour and 15 minutes (1.3)", formatVote(1.25));
            assert.equal(":coffee:", formatVote("coffee"));
            assert.equal("no time (0)", formatVote(0));
            assert.equal("no time (0)", formatVote(-1));
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

    describe("formatTask", () => {
        it("should format a simple task", () => {
            assert.equal(formatTask({
                title: "foobar",
                link: "http://google.com"
            }, {
                completed: [{}],
                pending: [{}],
                skipped: []
            }), "---\n:arrow_right: #2 [foobar](http://google.com) (1 of 2 tasks completed)");
        });

        it("should format a task with other skipped tasks", () => {
            assert.equal(formatTask({
                title: "foobar",
                link: "http://google.com"
            }, {
                completed: [{}],
                pending: [{}],
                skipped: [{}]
            }), "---\n:arrow_right: #2 [foobar](http://google.com) (1 of 2 tasks completed, 1 skipped)");
        });

        it("should format a task with a description", () => {
            assert.equal(formatTask({
                title: "foobar",
                link: "http://google.com",
                description: "a \n b\n\nc"
            }, {
                completed: [{}],
                pending: [{}],
                skipped: [{}]
            }), "---\n:arrow_right: #2 [foobar](http://google.com) (1 of 2 tasks completed, 1 skipped)\n\n> a \n>  b\n> \n> c\n");
        });
    });
});
