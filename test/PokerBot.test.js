import { TestBot } from "chat-bot";
import PokerBot from "../src/PokerBot.js";

const room = 1;
const moderator = 10;
const participants = [1, 2, 3];
const props = {
    room, moderator,
    participants: [1, 2, 3]
};

describe("PokerBot", () => {
    let bot;
    beforeEach(() => {
        bot = TestBot(PokerBot, props);
    });

    describe("state: waiting", () => {
        it("moderator: planning a bad tasklist input", async () => {
            await bot.handleMessage(moderatorMessage("plan http://foo.bar.com"));
            await bot.expectMessage(reply("Uh oh, I don't recognize that tasklist!", moderator));
        });

        it("moderator: planning a bad tasklist input", async () => {
            await bot.handleMessage(moderatorMessage("plan http://teamwork.com"));
            await bot.expectMessage(reply("Uh oh, I don't recognize that tasklist!", moderator));
        });
    });
});

function message(content, overrides) {
    return Object.assign({
        content,
        private: false,
        room: 10,
        author: 1
    }, overrides);
}

function reply(content, to, overrides) {
    return Object.assign({
        content, to
    });
}

function moderatorMessage(content, overrides) {
    return message(content, Object.assign({
        author: moderator
    }, overrides));
}