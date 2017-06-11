import {
    Bot,
    Rule,
    Mention,
    Command,
    Any
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
        const bots = this.state.bots.map(props => {
            return (
                <Poker {...props} />
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

    async createGame(input) {
        // Create the room
        const room = await this.createRoom({
            title: "Sprint planning poker"
        });

        // Get the users from the message's mentions
        const participants = await Promise.all(input.mentions.map(({ handle }) => this.getPersonByHandle(handle)));
        const moderator = input.author;

        if(!participants.length) {
            return this.reply(input, "Please mention at least two other people to join the game.");
        }

        // Add the user's to the room
        participants.concat(moderator).forEach(async person => {
            await this.addPersonToRoom(person.id, room.id);
        });

        // Add the bot to the state
        this.setState({
            bots: this.state.bots.concat({
                room,
                participants,
                moderator: input.author
            })
        });
    }
}