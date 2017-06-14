import assert from "assert";
import { Rule, From, Any, TestService } from "chat-bot";
import { expect } from "chai";
import Dealer from "../src/Dealer.js";

const EXAMPLE_TASKLIST = "https://1486461376533.teamwork.com/index.cfm#tasklists/457357";

describe("Dealer", () => {
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
            await Promise.all(players.map(person => chat.addPersonToRoom(person, room)));

            moderator = players[0];
            people = players.slice(1);
            player = people[1];

            bot = Rule.mount(<Dealer />, {
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

    it("should require at least one other person to create a new game", async () => {
        await chat.dispatchMessageToRoom(room, "@bot poker", moderator);
        await chat.expectMessageInRoom(room, /Please mention at least two other people/);
    });

    it("should create a new game with players and moderator", async () => {
        await chat.dispatchMessageToRoom(room, `@bot poker ${people.map(person => chat.formatMention(person)).join(", ")}`, moderator);
        const currentUser = await chat.getCurrentUser();
        const pokerRoom = (await chat.getAllRooms()).find(room => room.title.match(/sprint planning poker/i));
        const pokerPeople = await chat.getPeopleForRoom(pokerRoom);

        // Ensure all the players are in the room
        expect(players.concat(currentUser).map(({ id }) => id)).to.include.members(pokerPeople.map(({ id }) => id));

        const pokerBot = bot.state.bots[0];
        expect(pokerBot.moderator.id).to.equal(moderator.id);

        // Stub the `getTasks` function on the poker bot -> Any -> Poker
        bot.mount.mount[0].getTasks = getTasks;

        await chat.dispatchMessageToRoom(pokerRoom, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
        await chat.expectMessageInRoom(pokerRoom, /starting new game/i);
    });

    it("should handle multiple games", async () => {
        await chat.dispatchMessageToRoom(room, `@bot poker ${people.map(person => chat.formatMention(person)).join(", ")}`, moderator);
        const pokerRoom1 = (await chat.getAllRooms()).find(room => room.title.match(/sprint planning poker/i));
        await chat.dispatchMessageToRoom(room, `@bot poker ${people.map(person => chat.formatMention(person)).join(", ")}`, moderator);
        const pokerRoom2 = (await chat.getAllRooms()).find(room => room !== pokerRoom1 && room.title.match(/sprint planning poker/i));

        bot.mount.mount.forEach(rule => {
            if(rule.constructor.name === "Poker") {
                rule.getTasks = getTasks;
            }
        });

        await chat.dispatchMessageToRoom(pokerRoom1, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
        await chat.expectMessageInRoom(pokerRoom1, /starting new game/i);
        await chat.dispatchMessageToRoom(pokerRoom2, `@bot plan ${EXAMPLE_TASKLIST}`, moderator);
        await chat.expectMessageInRoom(pokerRoom2, /starting new game/i);

        // Remove one of the bots
        bot.setState({
            bots: bot.state.bots.slice(1)
        });

        await chat.dispatchMessageToRoom(pokerRoom1, "@bot start", moderator);
        await chat.expectMessageInRoom(pokerRoom1, /@bot start/);

        await chat.dispatchMessageToRoom(pokerRoom2, "@bot start", moderator);
        await chat.expectMessageInRoom(pokerRoom2, /please vote/i);
    });

    afterEach(() => {
        chat.popState();
        bot.popState();
    });
});

function getTasks() {
    return Promise.resolve([{
        title: "Example task",
        id: 1,
        link: "http://foobar.com"
    }, {
        title: "Example task 2",
        id: 2,
        link: "http://foobar.com"
    }, {
        title: "Example task 3",
        id: 3,
        link: "http://foobar.com"
    }]);
};