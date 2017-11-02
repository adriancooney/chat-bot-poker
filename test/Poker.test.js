import assert from "assert";
import { Rule, From, Any, TestService } from "chat-bot";
import { expect } from "chai";
import { api } from "./fixtures";
import Poker from "../src/Poker.js";

const EXAMPLE_TASKLIST = "https://1486461376533.teamwork.com/index.cfm#tasklists/457357";

describe("Poker", () => {
    let chat, room, people, players, moderator, player, bot;

    before(() => {
        chat = new TestService({
            debug: true
        });

        return chat.init().then(async () => {
            // Add some initial data
            room = await chat.createRoom({
                title: "Chat Team"
            });

            // Add the team
            players = await Promise.all([
                { firstName: "Adrian",  lastName: "Cooney",     handle: "adrianc" },
                { firstName: "Donal",   lastName: "Linehan",    handle: "donal" },
                { firstName: "Lukasz",  lastName: "Baczynski",  handle: "lukasz" },
                { firstName: "Dawid",   lastName: "Myslak",     handle: "dawid" },
                { firstName: "Michael", lastName: "Barrett",    handle: "michael" }
            ].map(chat.createPerson.bind(chat)));

            // Add them to Chat Team room
            await Promise.all(players.map(person => chat.addPersonToRoom(person, room)));

            moderator = players[0];
            people = players.slice(1);
            player = people[1];

            bot = await Rule.mount(<Poker api={api} moderator={moderator} room={room} participants={people} />, {
                service: chat,
                user: chat.user
            });

            chat.connect(bot);
        });
    });

    beforeEach(() => {
        chat.pushState();
    });

    afterEach(async () => {
        await chat.popState();
    });

    describe("initial state", () => {
        it("should be starting in a 'waiting' state", async () => {
            await chat.expectMessageInRoom(room, /welcome to sprint planning/i);
            assert.equal(bot.state.status, "waiting");
        });
    });

    describe("awaiting planning", () => {
        describe("@bot plan", () => {
            it("should do nothing if not moderator", async () => {
                const state = bot.state;
                await chat.dispatchMessageToRoom(room, "@bot plan", player);
                assert.equal(state, bot.state);
            });

            it("should require a tasklist", async () => {
                await chat.dispatchMessageToRoom(room, "@bot plan", moderator);
                await chat.expectMessageInRoom(room, /Please supply a tasklist/);
            });

            it("should require a tasklist", async () => {
                await chat.dispatchMessageToRoom(room, "@bot plan invalid-teamwork", moderator);
                await chat.expectMessageInRoom(room, /I don't recognize that tasklist/ig);
            });

            it("should retrieve the tasklist", async () => {
                await chat.dispatchMessageToRoom(room, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
                await chat.expectMessageInRoom(room, /waiting for the moderator to start/i);

                assert.equal(bot.state.status, "ready");
            });
        });
    });

    describe("ready to start", () => {
        before(async () => {
            chat.pushState();

            await chat.dispatchMessageToRoom(room, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
        });

        it("should be in a `ready` state", () => {
            assert.equal(bot.state.status, "ready");
        });

        it("should allow the moderator to start the game", async () => {
            await chat.dispatchMessageToRoom(room, "@bot start", moderator);
            await chat.expectMessageInRoom(room, /please vote/i)
            assert.equal(bot.state.status, "round");
        });

        it("should not allow any player to start the game", async () => {
            const state = bot.state;
            await chat.dispatchMessageToRoom(room, "@bot start", player);
            assert.equal(state, bot.state);
        });

        after(async () => {
            await chat.popState();
        });
    });

    describe("round", () => {
        before(async () => {
            chat.pushState();

            await chat.dispatchMessageToRoom(room, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
            await chat.dispatchMessageToRoom(room, "@bot start", moderator);
        });

        it("should sort the tasks in ascending order", () => {
            expect(bot.state.rounds.pending.map(({ task }) => task.order)).to.deep.equal([1, 2, 3])
        });

        it("should allow a player to vote publically", async () => {
            await chat.dispatchMessageToRoom(room, "@bot vote 10", player);
            await chat.expectMessageInRoom(room, /vote/i);
            await Promise.all(people.map(person => chat.expectMessageToPerson(person, new RegExp(`${player.firstName} has voted 10`, "i"))));

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(1);

            const vote = votes[0];
            expect(vote).to.have.property("value", 10);
            expect(vote).to.have.property("person", player.id);
        });

        it("should allow a player to vote privately", async () => {
            await chat.dispatchMessageToPerson(chat.user, "10", player);
            await chat.expectMessageInRoom(room, /has voted/);

            await Promise.all(
                people.map(person => chat.expectMessageToPerson(person, new RegExp(`${player.firstName} has voted\.$`, "i")))
            );

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(1);

            const vote = votes[0];
            expect(vote).to.have.property("value", 10);
            expect(vote).to.have.property("person", player.id);
        });

        it("should allow a player to update their vote", async () => {
            await chat.dispatchMessageToPerson(chat.user, "10", player);
            await chat.dispatchMessageToPerson(chat.user, "20", player);
            await chat.expectMessageToPerson(player, /Thanks, your vote has been updated to 20 hours/i);

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(1);

            const vote = votes[0];
            expect(vote).to.have.property("value", 20);

            expect(vote.history.length).to.equal(1);
            expect(vote.history[0]).to.have.property("value", 10);
        });

        it("should allow other players to vote", async () => {
            await chat.dispatchMessageToPerson(chat.user, "10", player);
            await chat.dispatchMessageToPerson(chat.user, "20", moderator);

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(2);
        });

        it("should allow other players to vote 'coffee'", async () => {
            await Promise.all(players.map((player, i) => chat.dispatchMessageToPerson(chat.user, i > players.length / 2 ? `${i}` : "coffee", player)));
            await chat.expectMessageInRoom(room, /feel it's time for a coffee break/);
        });

        it("should close the round after all players have voted", async () => {
            const votes = players.slice(1).map((_, i) => i).concat("coffee");
            await Promise.all(votes.map((vote, i) => chat.dispatchMessageToPerson(chat.user, `${vote}`, players[i])));
            await chat.expectMessageInRoom(room, /everyone has voted/i, 1);

            for(let person of people) {
                await chat.expectMessageToPerson(person, /everyone has voted/i, 1);
                await chat.expectMessageToPerson(person, /coffee break/i);
            }

            await chat.expectMessageToPerson(moderator, /coffee break/i, 1);
            await chat.expectMessageToPerson(moderator, /estimate/);

            expect(bot.state).to.have.property("status", "moderation");
        });

        it("should allow a moderator to manually estimate", async () => {
            await chat.dispatchMessageToPerson(chat.user, "estimate 10", moderator);
            await chat.expectMessageInRoom(room, /moderator picked final estimate/i, 2);
            expect(bot.state.rounds.completed.length).to.equal(1);
        });

        it("should allow the moderator to skip the round", async () => {
            await chat.dispatchMessageToPerson(chat.user, "skip", moderator);
            await chat.expectMessageInRoom(room, /moderator has skipped the task/i, 2);
            expect(bot.state.rounds.skipped.length).to.equal(1);
        });

        it("should allow the moderator to pass the round", async () => {
            const currentRound = bot.state.rounds.pending[0];
            await chat.dispatchMessageToPerson(chat.user, "pass", moderator);
            await chat.expectMessageInRoom(room, /moderator has passed the task/i, 2);
            const nextRound = bot.state.rounds.pending[0];
            const lastRound = bot.state.rounds.pending[bot.state.rounds.pending.length - 1];
            expect(currentRound.id).to.not.equal(nextRound.id);
            expect(lastRound.id).to.equal(currentRound.id);
        });

        it("should not allow the moderator to pass the round if it's the final round", async () => {
            // Complete all but the last round
            await Promise.all(bot.state.rounds.pending.slice(1).map(() =>
                chat.dispatchMessageToRoom(room, `@${chat.user.handle} estimate 10`, moderator)
            ));

            await chat.dispatchMessageToRoom(room, `@${chat.user.handle} pass`, moderator);
            await chat.expectMessageInRoom(room, /you cannot pass/i);
        });

        after(async () => {
            await chat.popState();
        });
    });

    describe("moderation", () => {
        before(async () => {
            chat.pushState();

            await chat.dispatchMessageToRoom(room, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
            await chat.dispatchMessageToRoom(room, "@bot start", moderator);
            await Promise.all(players.map((player, vote) => chat.dispatchMessageToPerson(chat.user, `${vote}`, player)));
        });

        it("should not allow players to vote during moderation", async () => {
            await chat.dispatchMessageToPerson(chat.user, `300`, player);
            expect(bot.state.rounds.pending[0].votes.find(vote => vote.person === player.id).value).to.not.equal(300);
        });

        it("should not accept invalid estimates from moderator", async () => {
            await chat.dispatchMessageToPerson(chat.user, `estimate coffee`, moderator);
            await chat.expectMessageToPerson(moderator, /please enter a positive numerical estimate/);

            await chat.dispatchMessageToPerson(chat.user, `estimate -1.1`, moderator);
            await chat.expectMessageToPerson(moderator, /please enter a positive numerical estimate/);
        });

        it("should accept valid input and move to the next round", async () => {
            await chat.dispatchMessageToPerson(chat.user, `estimate 1.5`, moderator);
            await chat.expectMessageInRoom(room, /moderator picked final estimate/i, 2);
            await chat.expectMessageInRoom(room, /please vote/i);

            const rounds = bot.state.rounds;
            expect(rounds.completed.length).to.equal(1);

            const completedRound = rounds.completed[0];
            expect(completedRound.finalVote).to.equal(1.5);

            expect(bot.state).to.have.property("status", "round");
        });

        after(async () => {
            await chat.popState();
        });
    });

    describe("leaving", () => {
        before(async () => {
            chat.pushState();

            await chat.dispatchMessageToRoom(room, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
            await chat.dispatchMessageToRoom(room, "@bot start", moderator);
        });

        it("should let a player leave", async () => {
            await chat.dispatchMessageToRoom(room, `@bot exit`, player);
            await chat.expectMessageInRoom(room, /has left/, 1);
            expect(bot.state.players).to.not.include(player);
        });

        it("should let a moderator leave", async () => {
            await chat.dispatchMessageToRoom(room, `@bot exit`, moderator);
            await chat.expectMessageInRoom(room, /moderator has left sprint planning/i);
        });

        after(async () => {
            await chat.popState();
        });
    });
});
