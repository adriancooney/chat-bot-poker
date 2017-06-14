export const api = {
    request(url, options) {
        return [
            [/\/tasklists\/(\d+)\/tasks.json/, this.getTasks.bind(this)],
            [/\/tasklists\/\d+.json/, this.getTasklist.bind(this)],
            ["/?action=invoke.tasks.OnSetTaskEstimates()", this.updateTask.bind(this)]
        ].reduce((req, [ matcher, fn ]) => {
            if(req) {
                return req;
            } else {
                const match = typeof matcher === "string" ? matcher === url : url.match(matcher);

                if(match) {
                    return fn.call(null, match);
                }
            }
        }, null);
    },

    getTasks() {
        return Promise.resolve({
            "todo-items": [{
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
            }]
        });
    },

    getTasklist() {
        return Promise.resolve({
            "todo-list": {
                id: 1,
                title: "Example",
                link: "http://foobar.com"
            }
        });
    },

    updateTask() {
        return Promise.resolve();
    }
}