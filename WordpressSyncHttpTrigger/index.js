// @ts-check
const { SyncEndpoint } = require('../wordpress-to-github');
const { slackBotReportError,slackBotChatPost,slackBotReplyPost,slackBotReactionAdd } = require('../common/slackBot');
const log = [];

const debugChannel = 'C02G6PETB9B'; //#wordpress-sync-http-trigger

const gitHubCommitter = {
    name: process.env["GITHUB_NAME"],
    email: process.env["GITHUB_EMAIL"]
};
const gitHubCredentials = { 
    token: process.env["GITHUB_TOKEN"] 
};

/**
 * 
 * @param {{executionContext:{functionName:string},res:{status?:number,body?:any,headers?:{"Content-Type":string}}}} context 
 * @param {{method:string,headers:{"user-agent":string},query:{},params:{},body:import('../wordpress-to-github/common').GitHubTarget}} req 
 */


module.exports = async function (context, req) {
    const appName = context.executionContext.functionName;
    let slackPostTS = "";
    try {
        const TriggerName = req.query['Trigger'] || req.body['trigger'] || '(Trigger)';
        const SlugName = req.body['slug'] || '(slug)';
        slackPostTS = (await (await slackBotChatPost(debugChannel,`${SlugName} - ${TriggerName}`)).json()).ts;
        await slackBotReplyPost(debugChannel, slackPostTS, `\n\n*Full Details*\n\`\`\`${JSON.stringify(req,null,2)}\`\`\``);

        if(!req.body || !req.body.Branch || !req.body.Owner || !req.body.Repo || !req.body.ConfigPath) {
            context.res = {
                status: 400,
                body: 'Bad Request - Expecting JSON - {Owner:string, Repo:string, Branch:string, ConfigPath:string}'
            };
            return;
        }

        function wait(timeout) {
            return new Promise(resolve => {
                setTimeout(resolve, timeout);
            });
        }
        await wait(10*1000); // let's wait 10 seconds before processing to try to avoid sync issues with the WP database

        await SyncEndpoint(req.body, gitHubCredentials, gitHubCommitter);
        await slackBotReactionAdd(debugChannel, slackPostTS, 'white_check_mark');
        await slackBotReplyPost(debugChannel, slackPostTS, 'POST Success');
        context.res = {
            status: 204 //OK - No content
        }; 
    } catch (e) {
        await slackBotReportError(debugChannel,`Error running ${appName}`,e,context,null);
        await slackBotReplyPost(debugChannel, slackPostTS, 'Error!');
        await slackBotReactionAdd(debugChannel, slackPostTS, 'no_entry');
        context.res = {
            status: 500,
            body: "Error - " + e.message
        };
    }
}