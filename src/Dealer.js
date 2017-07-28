import {
    Bot,
    Rule,
    Mention,
    Command,
    Any,
    Debug
} from "chat-bot";
import { without, uniq } from "lodash";
import Poker from "./Poker";

export default class Dealer extends Bot {
    constructor(props) {
        super(props);

        this.state = {
            bots: []
        };
    }

    render() {
        const bots = this.state.bots.map((props, i) => {
            return (
                <Poker nudge key={props.id}
                    api={this.props.api}
                    onComplete={this.onComplete.bind(this, props.id)}
                    onPlayerLeave={this.onPlayerLeave.bind(this, props.id)}
                    {...props} />
            )
        });

        return (
            <Any>
                { bots }
                <Mention>
                    <Command name="poker" handler={this.createGame.bind(this)} />
                </Mention>
            </Any>
        )
    }

    onComplete(id, game) {
        return this.setState({
            bots: this.state.bots.filter(bot => bot.id !== id)
        });
    }

    onPlayerLeave(id, player) {
        return this.setState({
            bots: this.state.bots.map(bot => ({
                ...bot,
                participants: without(bot.participants, player)
            }))
        });
    }

    async createGame(input) {
        const currentUser = await this.getCurrentUser();

        let participants;

        // Get the users from the message's mentions
        try {
            participants = await Promise.all(
                uniq(input.mentions)
                    .filter(({ handle }) => handle !== currentUser.handle)
                    .map(({ handle }) => this.getPersonByHandle(handle))
            );
        } catch(err) {
            if(err.message.match(/no person found/i)) {
                return this.reply(input, err.message);
            }

            throw err;
        }

        if(!participants.length) {
            return this.reply(input, "Please mention at least two other people to join the game.");
        }

        const moderator = input.author;
        const people = participants.concat(moderator);
        const currentGames = people.map(person => ({ person, game: this.getGameForPerson(person) })).filter(({ game }) => game);

        if(currentGames.length) {
            await Promise.all(currentGames.map(({ game, person }) => this.sendMessageToRoom(game.room, `:warning: ${this.formatMention(person)}, if you'd like to leave this game, send \`@bot exit\`.`)));
            return this.reply(input, `I cannot start a new game. ${currentGames.map(({ person }) => this.formatMention(person)).join(", ")} are already in sprint planning.`);
        }

        const room = await this.createRoom({
            title: "Sprint planning poker",
            people: participants.concat(moderator)
        });

        const id = `${Math.random()}-${Date.now()}`;

        // Add the bot to the state
        await this.setState({
            bots: this.state.bots.concat({
                id,
                room,
                participants,
                moderator
            })
        });
    }

    getGameForPerson(person) {
        return this.state.bots.find(bot => bot.moderator === person || bot.participants.includes(person));
    }
}