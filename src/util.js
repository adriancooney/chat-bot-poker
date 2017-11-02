import moment from "moment";
import {
    max,
    map,
    mapValues,
    property,
    sortBy,
    entries
} from "lodash";

export function formatMarkdownTable(rows, headers, titleMap = {}) {
    headers = headers || Object.keys(rows[0]).sort();

    const widths = headers.reduce((counts, header) => {
        return Object.assign(counts, {
            [header]: max(rows.map(row => Math.max((titleMap[header] || header).length, row[header].toString().length))) + 2
        });
    }, {});

    return [
        `| ${headers.map(header => (titleMap[header] || header).padEnd(widths[header] - 1 - (titleMap[header] || header).length)).join(" | ")} |`,
        `|${headers.map(header => "-".repeat(widths[header])).join("|")}|`
    ].concat(rows.map(row => {
        return `| ${headers.map(header => {
            const value = row[header].toString();
            return value.padEnd(widths[header] - 1 - value.length);
        }).join(" | ")} |`;
    })).join("\n");
}

export function formatVoteTable(votes, players) {
    const table = votes.reduce((table, vote) => {
        const person = players.find(person => person.id === vote.person);
        return Object.assign(table, {
            [person.firstName]: vote.value
        });
    }, {});

    return formatMarkdownTable([mapValues(table, formatVote)], sortBy(entries(table), property(1)).reverse().map(([ key ]) => key));
}

export function formatDuration(duration) {
    if(duration < 0) {
        duration = 0;
    }

    if(duration === 0) {
        return "no time";
    }

    const hrs = Math.floor(duration);
    const minutes = Math.ceil((duration - hrs) * 60);
    const output = [];

    if(hrs > 0) {
        output.push(`${hrs} hour${hrs > 1 ? "s" : ""}`);
    }

    if(minutes > 0) {
        output.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
    }

    return output.join(" and ");
}

export function formatVote(vote) {
    if(typeof vote === "number" && vote < 0) {
        vote = 0;
    }

    return typeof vote === "number" ? `${formatDuration(vote)} (${vote.toFixed(vote % 1 > 0 ? 1 : 0)})` :
        vote === "coffee" ? `:coffee:` : vote;
}

export function formatTask(task, rounds) {
    let output = `---\n:arrow_right: #${rounds.completed.length + 1} `;

    if(task["parent-task"]) {
        output += `${task["parent-task"].content} -> `;
    }

    output += `[${task.title}](${task.link}) (${formatGameProgress(rounds)})`;

    if(task.description) {
        output += "\n\n> " + task.description.split("\n").join("\n> ") + "\n";
    }

    return output;
}

export function formatGameProgress(rounds) {
    const totalPending = rounds.pending.length;
    const totalSkipped = rounds.skipped.length;
    const totalCompleted = rounds.completed.length;

    return `${totalCompleted} of ${totalPending + totalCompleted}` +
        ` tasks completed${totalSkipped > 0 ? `, ${totalSkipped} skipped` : ""}`;
}

export function parseTasklist(tasklist) {
    const match = tasklist.match(/(?:https?:\/\/)?([a-zA-Z\-_0-9]+)\.teamwork.com\/(?:index.cfm#)?\/?tasklists\/(\d+)/)

    if(match) {
        return {
            installation: match[1],
            id: parseInt(match[2], 10)
        };
    } else {
        return null;
    }
}

export function formatList(list) {
    let output = list[list.length - 1];

    if(list.length > 1) {
        output = list.slice(0, -1).join(", ") + " and " + output;
    }

    return output;
}
