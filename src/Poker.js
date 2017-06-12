import {
    unionBy,
    differenceBy
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

    onMount() {
        this.broadcast("Welcome to sprint planning!");
    }

    render() {
        return (
            <Any>
                { this.renderModerator() }
                { this.renderPlayers() }
                <From room={this.props.room}>
                    <Mention>
                        <Command name="status" handler={this.showStatus.bind(this)} />
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
                <From room={this.state.room} user={this.state.moderator}>
                    <Mention>
                        { inputs}
                    </Mention>
                </From>
                <Private>
                    { inputs }
                </Private>
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
                let voter = (
                    <Command name="vote">
                        <Vote onVote={this.handleVote.bind(this)} />
                    </Command>
                );

                publicInputs.push(voter);
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
                transition("NEW_GAME", { tasklist });

                return  {
                    ...state,
                    status: "ready",
                    rounds: {
                        pending: tasks.map(task => ({
                            ...task,
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
                    round: getCurrentRound(state)
                });

                return {
                    ...state,
                    status: "round"
                };
            }

            case "VOTE": {
                const { person, vote, direct } = action.payload;
                const timestamp = Date.now();
                const currentRound = getCurrentRound(state);

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
                        round: state.rounds.pending[0], vote
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
                const rounds = {
                    ...state.rounds,
                    skipped: state.rounds.skipped.concat(state.rounds.pending[0]),
                    pending: state.rounds.pending.slice(1)
                };

                transition("SKIP");

                let status;
                if(rounds.pending.length) {
                    status = "round";

                    // Transition to the next round
                    transition("NEXT_ROUND", {
                        round: state.rounds.pending[0]
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
                const rounds = {
                    ...state.rounds,
                    pending: state.rounds.pending.slice(1).concat({
                        ...state.rounds.pending[0],
                        votes: []
                    })
                };

                transition("PASS");
                transition("NEXT_ROUND", {
                    round: state.rounds.pending[0]
                });

                return {
                    ...state,
                    rounds
                }
            }

            default:
                return state;
        }
    }

    async transition(action, state, nextState, mutation) {
        switch(mutation.type) {
            case "NEW_GAME": {
                return this.broadcast(`Starting new game with tasklist: ${mutation.payload.tasklist}`);
            }

            case "NEXT_ROUND": {
                const { round, vote } = mutation.payload;

                if(vote) {
                    await this.broadcast(`Moderator picked final estimate of ${vote}`);
                }

                return this.broadcast(`Moving to the next round: ${round.title}`);
            }

            case "VOTE_COUNTED": {
                const { person, vote, direct } = mutation.payload;

                if(direct) {
                    await this.sendMessageToPerson(person.id, `Thanks ${this.formatMention(person)}, your vote of ${vote.value} has been counted.`);
                    await this.broadcast(`${person.firstName} has voted.`, [person]);
                } else {
                    await this.broadcast(`${person.firstName} has voted ${vote.value}.`);
                }

                return;
            }

            case "VOTE_UPDATED": {
                const { person, vote, direct } = mutation.payload;
                return this.sendMessageToPerson(person.id, `Thanks, you're vote has been updated.`);
            }

            case "ALL_VOTED": {
                await this.broadcast(`Thank you, everyone has voted.`);
                await this.sendMessageToPerson(this.state.moderator.id, `Okay moderator, please estimate.`);
                return;
            }

            case "PASS":
            case "SKIP": {
                return this.broadcast(`Moderator has ${mutation.type === "SKIP" ? "skipped" : "passed"} the round.`);
            }

            case "GAME_COMPLETE": {
                return this.broadcast(`Awesome, game over.`);
            }
        }
    }

    async broadcast(message, omit = []) {
        await Promise.all(
            differenceBy(this.state.players, omit, player => player.id)
                .map(player => this.sendMessageToPerson(player.id, message))
        );

        await this.sendMessageToRoom(this.state.room.id, message);
    }

    async plan(output, message) {
        const { content } = output;

        if(!content.trim()) {
            return this.reply(message, "Please supply a tasklist.");
        }

        // Attempt to validate the tasklist
        if(!content.match(/teamwork.com/)) {
            return this.reply(message, "Uh oh, I don't recognize that tasklist!");
        }

        // Grab the tasks from the API and create the rounds
        return this.dispatch("PLAN", {
            tasklist: content,
            tasks: await Teamwork.getTasks()
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

    pass(input) {
        if(this.state.rounds.pending.length === 1) {
            return this.reply(input, "This is the last round, you cannot pass!");
        }

        return this.dispatch("PASS");
    }

    estimate(input) {
        const estimate = parseFloat(input.content);

        if(isNaN(estimate) || estimate < 0) {
            return this.reply(input, `Sorry ${this.state.moderator.firstName}, please enter a positive numerical estimate.`);
        }

        // TODO: Update estimate on task in Projects

        return this.dispatch("FINAL_VOTE", {
            vote: estimate
        });
    }

    showStatus(message) {
        return this.reply(message, "Showing status.");
    }
}

const getCurrentRound = state => state.rounds.pending[0];

class Vote extends Bot {
    static VOTE_EXPR = /(\d+(?:\.\d+)?|coffee|infinity)/;

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

export class Teamwork {
    static async getTasks() {
        return [{
            title: "Example task",
            id: 1
        }, {
            title: "Example task 2",
            id: 2
        }, {
            title: "Example task 3",
            id: 3
        }];
    }
}