import {
    Bot,
    Rule,
    Mention,
    Command,
    Any,
    Debug
} from "chat-bot";
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
                <Poker key={props.id} {...props} />
            )
        });

        return (
            <Any>
                { bots }
                <Mention>
                    <Command name="poker" handler={this.createGame.bind(this)} />
                </Mention>
                <Debug name="dealer" />
            </Any>
        )
    }

    async createGame(input) {
        const currentUser = await this.getCurrentUser();

        let participants;

        // Get the users from the message's mentions
        try {
            participants = await Promise.all(
                input.mentions
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
        const room = await this.createRoom({
            title: "Sprint planning poker",
            people: participants.concat(moderator)
        });

        // Add the bot to the state
        this.setState({
            bots: this.state.bots.concat({
                room,
                participants,
                moderator,
                id: Math.random()
            })
        });
    }
}