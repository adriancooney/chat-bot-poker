import assert from "assert";
import { Rule, From, Any, TestService } from "chat-bot";
import { expect } from "chai";
import PokerBot from "../src/Poker.js";

describe("PokerBot", () => {
    let chat, room, people, players, moderator, player, bot;

    before(() => {
        chat = new TestService();

        return chat.init().then(async () => {
            // Add some initial data
            room = await chat.createRoom({
                title: "Chat Team"
            });

            // Add the team
            players = await Promise.all([
                { firstName: "Adrian", lastName: "Cooney", handle: "adrianc" },
                { firstName: "Donal", lastName: "Linehan", handle: "donal" },
                { firstName: "Lukasz", lastName: "Baczynski", handle: "lukasz" },
                { firstName: "Dawid", lastName: "Myslak", handle: "dawid" },
                { firstName: "Michael", lastName: "Barrett", handle: "michael" }
            ].map(chat.createPerson.bind(chat)));

            // Add them to Chat Team room
            await Promise.all(players.map(person => chat.addPersonToRoom(person.id, room.id)));

            moderator = players[0];
            people = players.slice(1);
            player = people[1];

            bot = Rule.mount(<PokerBot moderator={moderator} room={room} participants={people} />, {
                service: chat,
                user: chat.user
            });

            chat.connect(bot);
        });
    });

    beforeEach(() => {
        chat.pushState();
        bot.pushState();
    });

    afterEach(() => {
        chat.popState();
        bot.popState();
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
                await chat.dispatchMessageToRoom(room.id, "@bot plan", player);
                assert.equal(state, bot.state);
            });

            it("should require a tasklist", async () => {
                await chat.dispatchMessageToRoom(room.id, "@bot plan", moderator);
                await chat.expectMessageInRoom(room, /Please supply a tasklist/);
            });

            it("should require a tasklist", async () => {
                await chat.dispatchMessageToRoom(room.id, "@bot plan invalid-teamwork", moderator);
                await chat.expectMessageInRoom(room, /I don't recognize that tasklist/ig);
            });

            it("should retrieve the tasklist", async () => {
                await chat.dispatchMessageToRoom(room.id, "@bot plan teamwork.com/tasklist/foo", moderator);
                await chat.expectMessageInRoom(room, /starting new game/i);

                assert.equal(bot.state.status, "ready");
            });
        });
    });

    describe("ready to start", () => {
        before(async () => {
            chat.pushState();
            bot.pushState();

            await chat.dispatchMessageToRoom(room.id, "@bot plan teamwork.com/foo", moderator);
        });

        it("should be in a `ready` state", () => {
            assert.equal(bot.state.status, "ready");
        });

        it("should allow the moderator to start the game", async () => {
            await chat.dispatchMessageToRoom(room.id, "@bot start", moderator);
            await chat.expectMessageInRoom(room, /moving to the next round/i)
            assert.equal(bot.state.status, "round");
        });

        it("should not allow any player to start the game", async () => {
            const state = bot.state;
            await chat.dispatchMessageToRoom(room.id, "@bot start", player);
            assert.equal(state, bot.state);
        });

        after(async () => {
            chat.popState();
            bot.popState();
        });
    });

    describe("round", () => {
        before(async () => {
            chat.pushState();
            bot.pushState();

            await chat.dispatchMessageToRoom(room.id, "@bot plan teamwork.com/foo", moderator);
            await chat.dispatchMessageToRoom(room.id, "@bot start", moderator);
        });

        it("should allow a player to vote publically", async () => {
            await chat.dispatchMessageToRoom(room.id, "@bot vote 10", player);
            await chat.expectMessageInRoom(room, /vote/i);
            await Promise.all(people.map(person => chat.expectMessageToPerson(person, new RegExp(`${player.firstName} has voted 10`, "i"))));

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(1);

            const vote = votes[0];
            expect(vote).to.have.property("value", 10);
            expect(vote).to.have.property("person", player.id);
        });

        it("should allow a player to vote privately", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, "vote 10", player);
            await chat.expectMessageInRoom(room, /has voted/);
            await chat.expectMessageToPerson(player, /your vote of 10 has been counted/);

            await Promise.all(
                people.filter(person => person.id !== player.id)
                    .map(person => chat.expectMessageToPerson(person, new RegExp(`${player.firstName} has voted\.$`, "i")))
            );

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(1);

            const vote = votes[0];
            expect(vote).to.have.property("value", 10);
            expect(vote).to.have.property("person", player.id);
        });

        it("should allow a player to update their vote", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, "vote 10", player);
            await chat.dispatchMessageToPerson(chat.user.id, "vote 20", player);
            await chat.expectMessageToPerson(player, /Thanks, you're vote has been updated./);

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(1);

            const vote = votes[0];
            expect(vote).to.have.property("value", 20);

            expect(vote.history.length).to.equal(1);
            expect(vote.history[0]).to.have.property("value", 10);
        });

        it("should allow other players to vote", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, "vote 10", player);
            await chat.dispatchMessageToPerson(chat.user.id, "vote 20", moderator);

            const votes = bot.state.rounds.pending[0].votes;
            expect(votes.length).to.equal(2);
        });

        it("should close the round after all players have voted", async () => {
            const votes = players.map((_, i) => i);
            await Promise.all(votes.map((vote, i) => chat.dispatchMessageToPerson(chat.user.id, `vote ${vote}`, players[i])));
            await chat.expectMessageInRoom(room, /everyone has voted/i);
            await Promise.all(people.map(person => chat.expectMessageToPerson(person, /everyone has voted/i)));
            await chat.expectMessageToPerson(moderator, /estimate/);

            expect(bot.state).to.have.property("status", "moderation");
        });

        it("should allow a moderator to manually estimate", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, "estimate 10", moderator);
            await chat.expectMessageInRoom(room, /moderator picked final estimate of 10/i, 1);
            expect(bot.state.rounds.completed.length).to.equal(1);
        });

        it("should allow the moderator to skip the round", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, "skip", moderator);
            await chat.expectMessageInRoom(room, /moderator has skipped the round/i, 1);
            expect(bot.state.rounds.skipped.length).to.equal(1);
        });

        it.only("should allow the moderator to pass the round", async () => {
            const currentRound = bot.state.rounds.pending[0];
            await chat.dispatchMessageToPerson(chat.user.id, "pass", moderator);
            await chat.expectMessageInRoom(room, /moderator has passed the round/i, 1);
            const nextRound = bot.state.rounds.pending[0];
            const lastRound = bot.state.rounds.pending[bot.state.rounds.pending.length - 1];
            expect(currentRound.id).to.not.equal(nextRound.id);
            expect(lastRound.id).to.equal(currentRound.id);
        });

        after(async () => {
            chat.popState();
            bot.popState();
        });
    });

    describe("moderation", () => {
        before(async () => {
            chat.pushState();
            bot.pushState();

            await chat.dispatchMessageToRoom(room.id, "@bot plan teamwork.com/foo", moderator);
            await chat.dispatchMessageToRoom(room.id, "@bot start", moderator);
            await Promise.all(players.map((player, vote) => chat.dispatchMessageToPerson(chat.user.id, `vote ${vote}`, player)));
        });

        it("should not allow players to vote during moderation", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, `vote 300`, player);
            expect(bot.state.rounds.pending[0].votes.find(vote => vote.person === player.id).value).to.not.equal(300);
        });

        it("should not accept invalid estimates from moderator", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, `estimate coffee`, moderator);
            await chat.expectMessageToPerson(moderator, /please enter a positive numerical estimate/);

            await chat.dispatchMessageToPerson(chat.user.id, `estimate -1.1`, moderator);
            await chat.expectMessageToPerson(moderator, /please enter a positive numerical estimate/);
        });

        it("should accept valid input and move to the next round", async () => {
            await chat.dispatchMessageToPerson(chat.user.id, `estimate 1.5`, moderator);
            await chat.expectMessageInRoom(room, /moderator picked final estimate of 1.5/i, 1);
            await chat.expectMessageInRoom(room, /moving to the next round/i);

            const rounds = bot.state.rounds;
            expect(rounds.completed.length).to.equal(1);

            const completedRound = rounds.completed[0];
            expect(completedRound.finalVote).to.equal(1.5);

            expect(bot.state).to.have.property("status", "round");
        });

        after(async () => {
            chat.popState();
            bot.popState();
        });
    });
});