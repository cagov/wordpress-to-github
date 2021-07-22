// @ts-check
const { SyncEndpoint } = require('../wordpress-to-github');
const { slackBotReportError,slackBotChatPost,slackBotReplyPost } = require('../common/slackBot');
const log = [];
//const debugChannel = 'C01DBP67MSQ'; // #testingbot
const debugChannel = 'C01H6RB99E2'; //Carter debug
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
        slackPostTS = (await (await slackBotChatPost(debugChannel,`\n\n*Request Logged*\n\`\`\`${JSON.stringify(req,null,2)}\`\`\``)).json()).ts;

        await SyncEndpoint(req.body, gitHubCredentials, gitHubCommitter);
        await slackBotReplyPost(debugChannel, slackPostTS, 'POST Success');
        context.res = {
            status: 204 //OK - No content
        }; 
    } catch (e) {
        await slackBotReportError(debugChannel,`Error running ${appName}`,e,context,null);
        await slackBotReplyPost(debugChannel, slackPostTS, 'Error!');
        context.res = {
            status: 500,
            body: "Error - " + JSON.stringify(e,null,2)
        };
    }
}