import qs from "qs";
import {
    unionBy,
    differenceBy,
    mean,
    min,
    max,
    sum,
    without
} from "lodash";
import {
    Bot,
    Rule,
    Mention,
    Command,
    From,
    Any,
    Default,
    Private,
    Match
} from "chat-bot";
import {
    formatMarkdownTable,
    formatVoteTable,
    formatVote,
    parseTasklist,
    formatList
} from "./util";

export default class Poker extends Bot {
    constructor(props, context) {
        super(props, context);

        const { room, moderator, participants } = props;

        this.state = {
            room,
            moderator,
            players: participants.concat(moderator),
            status: "waiting",
            rounds: {
                pending: [],
                completed: [],
                skipped: []
            }
        };
    }

    render() {
        return (
            <Any>
                { this.renderModerator() }
                { this.renderPlayers() }
                <From room={this.props.room}>
                    <Mention>
                        <Command name="status" handler={this.showStatus.bind(this)} />
                        <Command name="exit" handler={this.exitPlayer.bind(this)} />
                    </Mention>
                </From>
            </Any>
        );
    }

    renderModerator() {
        const inputs = [
            <Command name="add" handler={this.addUser.bind(this)} />,
            <Command name="remove" handler={this.removeUser.bind(this)} />
        ];

        switch(this.state.status) {
            // First state: when the players enter the room and we're waiting for
            // a tasklist from the moderator to plan.
            case "waiting":
                inputs.push(
                    <Command name="plan" handler={this.plan.bind(this)} />
                );
            break;

            // Second state: when the tasklist has been picked and we're waiting
            // for the mdoerator to begin the game.
            case "ready":
                inputs.push(
                    <Command name="start" handler={this.start.bind(this)} />
                );
            break;

            // Third state: When a round is in progress, a moderator can
            // skip, pass or manually estimate the round.
            case "round":
            case "moderation": {
                inputs.push(
                    <Command name="skip" handler={this.skip.bind(this)} />,
                    <Command name="pass" handler={this.pass.bind(this)} />,
                    <Command name="estimate" handler={this.estimate.bind(this)} />
                );
            }
        }

        return (
            <Any>
                <From user={this.state.moderator}>
                    <From room={this.state.room}>
                        <Mention>
                            { inputs}
                        </Mention>
                    </From>
                    <Private>
                        { inputs }
                    </Private>
                </From>
            </Any>
        );
    }

    renderPlayers() {
        const publicInputs = [];
        const privateInputs = [];

        switch(this.state.status) {
            // First state: During a round, plays can publically or privately vote.
            // In public, they have to prefix it with the command `vote`
            case "round": {
                let voter = <Vote onVote={this.handleVote.bind(this)} />;

                publicInputs.push(
                    <Command name="vote">
                        { voter }
                    </Command>
                );

                privateInputs.push(voter);

                break;
            }

            default: {
                return null;
            }
        }

        return (
            <Any>
                <Mention>
                    { publicInputs }
                </Mention>
                <Private>
                    { privateInputs }
                </Private>
            </Any>
        );
    }

    reduce(state, action, transition) {
        switch(action.type) {
            case "PLAN": {
                const { tasklist, tasks } = action.payload;
                transition("NEW_GAME", { tasklist, tasks });

                return  {
                    ...state,
                    status: "ready",
                    timestamps: {
                        start: Date.now()
                    },
                    rounds: {
                        pending: tasks.map(task => ({
                            task,
                            id: task.id,
                            votes: []
                        })),
                        completed: [],
                        skipped: []
                    },
                    tasklist
                };
            }

            case "START": {
                transition("NEXT_ROUND", {
                    round: state.rounds.pending[0]
                });

                return {
                    ...state,
                    status: "round"
                };
            }

            case "VOTE": {
                const { person, vote, direct } = action.payload;
                const timestamp = Date.now();
                const currentRound = state.rounds.pending[0];

                // Find the person's current/previous votes
                let personVote = currentRound.votes.find(vote => vote.person === person.id);

                // If they've already voted, update their vote
                if(personVote) {
                    personVote = {
                        ...personVote,
                        value: vote,
                        timestamp,
                        history: personVote.history.concat({
                            value: personVote.value,
                            timestamp: personVote.timestamp
                        })
                    };

                    transition("VOTE_UPDATED", { person, vote: personVote, direct });
                } else {
                    // Create the vote
                    personVote = {
                        value: vote,
                        timestamp,
                        person: person.id,
                        history: []
                    };

                    transition("VOTE_COUNTED", { person, vote: personVote, direct });
                }

                // Add the person's vote to the current round
                const round = {
                    ...currentRound,
                    votes: unionBy([personVote], currentRound.votes, vote => vote.person)
                };

                let rounds, status = state.status;
                if(round.votes.length >= state.players.length) {
                    // Everyone has voted, hooray!
                    transition("ALL_VOTED");
                    status = "moderation";
                }

                return {
                    ...state,
                    status,
                    rounds: {
                        ...state.rounds,
                        pending: unionBy([round], state.rounds.pending, "id")
                    }
                };
            }

            case "FINAL_VOTE": {
                const { vote } = action.payload;

                const round = {
                    ...state.rounds.pending[0],
                    finalVote: vote
                };

                const rounds = {
                    ...state.rounds,
                    completed: state.rounds.completed.concat(round),
                    pending: state.rounds.pending.slice(1)
                };

                let status;
                if(rounds.pending.length) {
                    status = "round";

                    // Transition to the next round
                    transition("NEXT_ROUND", {
                        round: rounds.pending[0], vote
                    });
                } else {
                    status = "complete";

                    // If we have no more pending rounds left, we're done!
                    transition("GAME_COMPLETE");
                }

                return {
                    ...state,
                    rounds,
                    status
                }
            }

            case "SKIP": {
                const round = state.rounds.pending[0];

                const rounds = {
                    ...state.rounds,
                    skipped: state.rounds.skipped.concat(round),
                    pending: state.rounds.pending.slice(1)
                };

                transition("SKIP", { round });

                let status;
                if(rounds.pending.length) {
                    status = "round";

                    // Transition to the next round
                    transition("NEXT_ROUND", {
                        round: rounds.pending[0]
                    });
                } else {
                    status = "complete";

                    // If we have no more pending rounds left, we're done!
                    transition("GAME_COMPLETE");
                }

                return {
                    ...state,
                    rounds,
                    status
                };
            }

            case "PASS": {
                const round = state.rounds.pending[0];
                const rounds = {
                    ...state.rounds,
                    pending: state.rounds.pending.slice(1).concat({
                        ...state.rounds.pending[0],
                        votes: []
                    })
                };

                transition("PASS", { round });
                transition("NEXT_ROUND", {
                    round: rounds.pending[0]
                });

                return {
                    ...state,
                    rounds
                }
            }

            case "REMOVE_PLAYER": {
                const player = action.payload.player;

                if(player === state.moderator) {
                    transition("MODERATOR_LEFT");

                    return {
                        cancelled: true,
                        ...state
                    };
                }

                transition("PLAYER_LEFT", { player });

                return {
                    ...state,
                    players: without(state.players, player)
                };
            }

            default:
                return state;
        }
    }

    async transition(action, state, nextState, mutation) {
        if(!action && !state) {
            const currentUser = await this.getCurrentUser();

            return this.broadcast(player => {
                let output = `:mega: Welcome to Sprint Planning Poker!\n`

                if(player && player.id === this.state.moderator.id) {
                    output += `:guardsman: ${player.firstName}, you are the moderator. To pick a tasklist to plan, send \`plan <tasklist url>\`.\n`;
                } else {
                    output += `:guardsman: ${this.formatMention(this.state.moderator)}, is the moderator.\n`;
                    output += `:mega: We're waiting for the moderator to pick a tasklist to plan (\`${this.formatMention(currentUser)} plan <tasklist url>\`).\n`;
                }

                return output;
            });
        }

        switch(mutation.type) {
            case "NEW_GAME": {
                const { tasklist, tasks } = mutation.payload;
                const currentUser = await this.getCurrentUser();

                await this.broadcast(`:mega: Planning: [${tasklist.title}](${tasklist.link}) (${tasks.length} tasks)`);
                await this.broadcast(player => {
                    if(!player) {
                        return `:mega: Waiting for the moderator to start (${this.formatMention(nextState.moderator)}, send \`${this.formatMention(currentUser)} start\`).`;
                    } else if(player.id === nextState.moderator.id) {
                        return `:mega: Waiting for you to start the game, ${nextState.moderator.firstName}. Send \`start\`.`;
                    } else {
                        return `:mega: Waiting for moderator to start.`
                    }
                });

                return;
            }

            case "NEXT_ROUND": {
                const { round, vote } = mutation.payload;
                const currentUser = await this.getCurrentUser();

                if(vote) {
                    await this.broadcast(`:mega: Moderator picked final estimate of **${formatVote(vote)}**.`);
                }

                const moderator = nextState.players.find(player => player.id === nextState.moderator.id);
                const totalPending = nextState.rounds.pending.length;
                const totalSkipped = nextState.rounds.skipped.length;
                const totalCompleted = nextState.rounds.completed.length;
                const totalTasks = totalPending + totalSkipped + totalCompleted;

                let output = `---\n:arrow_right: #${totalCompleted + 1} `;

                if(round.task["parent-task"]) {
                    const parentTask = round.task["parent-task"];
                    output += `${parentTask.content} -> `;
                }

                output += `[${round.task.title}](${round.task.link}) (${totalCompleted} of ${totalPending + totalCompleted} tasks completed${totalSkipped > 0 ? `, ${totalSkipped} skipped` : ""})`;

                await this.broadcast(output);

                await this.broadcast(player => {
                    const isModerator = player && player.id === nextState.moderator.id;
                    let output = `:mega: Please vote by ${!player ? `sending \`${this.formatMention(currentUser)} vote <estimate>\` or in a private message.` : "sending just a number estimate."}\n`;

                    let skippable = false;
                    if(round.task["estimated-minutes"]) {
                        output += `:warning: This task already has an estimate of ${formatVote(round.task["estimated-minutes"]/60)}.\n`;
                        skippable = true;
                    }

                    if(round.task["has-predecessors"]) {
                        output += `:warning: This is a parent task of ${round.task["has-predecessors"]} subtasks.\n`;
                        skippable = true;
                    }

                    if(skippable) {
                        if(isModerator) {
                            output += `:guardsman: You, as moderator, can skip the task by sending \`skip\`.\n`;
                        } else {
                            output += `:guardsman: The moderator can skip the task by \`${this.formatMention(currentUser)} skip\`.\n`;
                        }
                    }

                    if(isModerator) {
                        output += `:guardsman: You can manually set the estimate by sending \`estimate <estimate>\` or push the task to the end with \`pass\`.\n`;
                    }

                    return output + `:${player ? "white_circle" : "warning"}: Voting here is **${player ? "private" : "public"}**.`
                });

                return;
            }

            case "VOTE_COUNTED": {
                const { person, vote, direct } = mutation.payload;

                if(direct) {
                    await this.broadcast(`:ballot_box_with_check: ${person.firstName} has voted.`);
                } else {
                    await this.broadcast(`:ballot_box_with_check: ${person.firstName} has voted ${formatVote(vote.value)}.`);
                }

                return;
            }

            case "VOTE_UPDATED": {
                const { person, vote, direct } = mutation.payload;
                if(direct) {
                    await this.sendMessageToPerson(person, `Thanks, your vote has been updated to ${formatVote(vote.value)}.`);
                    await this.broadcast(`:ballot_box_with_check: ${person.firstName} has updated their vote.`, [person]);
                } else {
                    await this.broadcast(`:ballot_box_with_check: ${person.firstName} has updated their vote to ${formatVote(vote.value)}.`);
                }

                return;
            }

            case "ALL_VOTED": {

                const round = nextState.rounds.pending[0];
                const votes = round.votes;
                const numericalVotes = votes.filter(vote => !isNaN(vote.value)).map(vote => vote.value);
                const averageVote = mean(numericalVotes);
                const maxVote = max(numericalVotes);
                const minVote = min(numericalVotes);

                // PERT value
                const suggestedVote = (minVote + 4 * averageVote + maxVote) / 6;
                const voteDeviation = (maxVote - minVote) / 6;

                await this.broadcast(
                    `:high_brightness: Thank you, everyone has voted. Suggested estimate: ${formatVote(suggestedVote)} (can take up to ${formatVote(voteDeviation)} ` +
                    `more, based on vote deviation)\n\n` +
                    ` ${formatVoteTable(votes, nextState.players)}\n\n` +
                    `:mega: Awaiting moderator to estimate task.`
                );

                const coffees = votes.filter(vote => vote.value === "coffee");

                if(coffees.length) {
                    await this.broadcast(`:coffee: ${formatList(coffees.map(vote => nextState.players.find(person => person.id === vote.person).firstName))} feels it's time for a coffee break.`);
                }

                await this.sendMessageToPerson(this.state.moderator, `Okay moderator, please submit your estimate. (\`estimate 10\` to estimate 10 hours)`);
                return;
            }

            case "PASS":
            case "SKIP": {
                const round = mutation.payload.round;
                return this.broadcast(`:mega: Moderator has ${mutation.type === "SKIP" ? "skipped" : "passed"} the task *${round.task.title}*.`);
            }

            case "GAME_COMPLETE": {
                let output = `:mega: Sprint planning complete: [${nextState.tasklist.title}](${nextState.tasklist.link})\n`;
                output += `:hourglass: The planning took **${formatVote((Date.now() - nextState.timestamps.start) / (60 * 60 * 1000))}**.\n`;

                if(nextState.rounds.completed.length) {
                    const totalHours = sum(nextState.rounds.completed.map(round => round.finalVote));
                    output += `:clock2: The sprint is **${formatVote(totalHours)}** in total.\n`;

                    const headers = ["title", ...nextState.players.map(person => person.firstName), "finalVote"];
                    const rows = nextState.rounds.completed.map(round => {
                        const votes = nextState.players.reduce((votes, person) => {
                            const vote = round.votes.find(vote => vote.person === person.id);

                            return Object.assign(votes, {
                                [person.firstName]: vote ? vote.value : "-"
                            })
                        }, {});

                        return Object.assign(votes, {
                            title: `[${round.task.title}](${round.task.link})`,
                            finalVote: round.finalVote
                        });
                    });

                    const completedTable = formatMarkdownTable(rows, headers, {
                        "title": "Title",
                        "finalVote": "Final Vote"
                    });

                    output += `\n${completedTable}\n`;
                }

                if(nextState.rounds.skipped.length) {
                    const skippedRounds = nextState.rounds.skipped.map(round => {
                        return ` * [${round.task.title}](${round.task.link})`
                    }).join("\n");

                    output += `\nSkipped tasks:\n${skippedRounds}`;
                }

                await this.broadcast(output);

                if(this.props.onComplete) {
                    await this.props.onComplete(this.state);
                }

                return;
            }

            case "MODERATOR_LEFT": {
                await this.broadcast(":warning: Moderator has left sprint planning, cancelling! Sprint planning over.");

                if(this.props.onComplete) {
                    await this.props.onComplete(this.state);
                }

                return;
            }

            case "PLAYER_LEFT": {
                const { player } = mutation.payload;
                await this.broadcast(`:warning: ${player.firstName} has left sprint planning.`);
                await this.broadcast(`:warning: ${player.firstName} you're technically out of the game (you cannot participate) but I currently don't support removing people from rooms. Please leave the room.`);

                if(this.props.onPlayerLeave) {
                    await this.props.onPlayerLeave(player);
                }

                return;
            }
        }
    }

    async broadcast(message, omit = []) {
        await Promise.all(
            differenceBy(this.state.players, omit, player => player.id)
                .map(player => this.sendMessageToPerson(player, typeof message === "function" ? message(player) : message))
        );

        await this.sendMessageToRoom(this.state.room, typeof message === "function" ? message() : message);
    }

    async plan(output, message) {
        const { content } = output;

        if(!content.trim()) {
            return this.reply(message, "Please supply a tasklist.");
        }

        let tasklist = parseTasklist(content);

        // Attempt to validate the tasklist
        if(!tasklist) {
            return this.reply(message, "Uh oh, I don't recognize that tasklist! Example: `https://1486461376533.teamwork.com/index.cfm#tasklists/457357`");
        }

        // Grab the tasklist from the API
        tasklist = await this.getTasklist(tasklist.id);
        const tasks = await this.getTasks(tasklist);

        // Grab the tasks from the API and create the rounds
        return this.dispatch("PLAN", {
            tasklist, tasks
        });
    }

    handleVote(person, vote, direct) {
        return this.dispatch("VOTE", {
            vote, person, direct
        });
    }

    start() {
        return this.dispatch("START");
    }

    addUser() {

    }

    removeUser() {

    }

    skip() {
        return this.dispatch("SKIP");
    }

    exitPlayer(input) {
        return this.dispatch("REMOVE_PLAYER", {
            player: input.author
        });
    }

    pass(input) {
        if(this.state.rounds.pending.length === 1) {
            return this.reply(input, "This is the last round, you cannot pass!");
        }

        return this.dispatch("PASS");
    }

    async estimate(input) {
        const estimate = parseFloat(input.content);

        if(isNaN(estimate) || estimate < 0) {
            return this.reply(input, `Sorry ${this.state.moderator.firstName}, please enter a positive numerical estimate.`);
        }

        await this.updateTask(this.state.tasklist, this.state.rounds.pending[0].task.id, estimate);

        return this.dispatch("FINAL_VOTE", {
            vote: estimate
        });
    }

    showStatus(message) {
        return this.reply(message, "Showing status.");
    }

    async getTasklist(id) {
        const tasklist = (await this.props.api.request(`/tasklists/${id}.json`))["todo-list"];

        return Object.assign(tasklist, {
            id: parseInt(tasklist.id, 10),
            title: tasklist.name,
            link: `${this.props.api.installation}/#/tasklists/${tasklist.id}`
        });
    }

    async getTasks(tasklist) {
        const tasks = (await this.props.api.request(`/tasklists/${tasklist.id}/tasks.json`))["todo-items"];

        return tasks.map(task => Object.assign(task, {
            title: task.content,
            link: `${this.props.api.installation}/#/tasks/${task.id}`
        }));
    }

    async updateTask(tasklist, id, estimate) {
        const hours = Math.floor(estimate);
        const minutes = Math.floor((estimate - hours) * 60);

        await this.props.api.request("/?action=invoke.tasks.OnSetTaskEstimates()", {
            method: "POST",
            raw: true,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "twProjectsVer": "2.0"
            },
            body: qs.stringify({
                projectId: tasklist.projectId,
                taskId: id,
                taskEstimateHours: hours,
                taskEstimateMins: minutes
            })
        });
    }
}

class Vote extends Bot {
    static VOTE_EXPR = /^\s*((?:\d+(?:\.\d+)?)|coffee|infinity)/;

    render() {
        // Votes can one of the following
        return (
            <Match expr={Vote.VOTE_EXPR} groups={["vote"]} handler={this.onVote.bind(this)} />
        );
    }

    handleInvalidInput(input) {
        return this.reply(input, `Sorry, I didn't understand that ${input.author.firstName}.`);
    }

    onVote(output, message) {
        const vote = output.vote === "infinity" || output.vote === "coffee" ? output.vote : parseFloat(output.vote);

        if(this.props.onVote) {
            return this.props.onVote(message.author, vote, message.private);
        }
    }

    toString() {
        return `votes one of ${Vote.VOTE_EXPR.toString()}`
    }
}