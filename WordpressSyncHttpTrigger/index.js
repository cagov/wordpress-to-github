const log = [];

module.exports = async function (context, req) {
    log.unshift(req);

    context.res = {
        // status: 200, /* Defaults to 200 */
        body: JSON.stringify(log,null,2),
        headers: {
            "Content-Type": "application/json"
        }
    };
}