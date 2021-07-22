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
 * @param {{executionContext:{functionName:string},res:{body:any,headers:{"Content-Type":string}}}} context 
 * @param {{method:string,headers:{"user-agent":string},query:{},params:{},body:import('../wordpress-to-github/common').GitHubTarget}} req 
 */
module.exports = async function (context, req) {
    const appName = context.executionContext.functionName;
    try {
        const slackPostTS = (await (await slackBotChatPost(debugChannel,`\n\n*Request Logged*\n\`\`\`${JSON.stringify(req,null,2)}\`\`\``)).json()).ts;
        if(req.method==='POST') {
            await SyncEndpoint(req.body, gitHubCredentials, gitHubCommitter);
        }
        await slackBotReplyPost(debugChannel, slackPostTS, 'Done');
        
        log.unshift(req);

        context.res = {
            // status: 200, /* Defaults to 200 */
            body: JSON.stringify(log,null,2),
            headers: {
                "Content-Type": "application/json"
            }
        }; 
    } catch (e) {
        await slackBotReportError(debugChannel,`Error running ${appName}`,e,context,null);
    }
}