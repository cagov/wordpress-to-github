// @ts-check
const { slackBotReportError,slackBotChatPost } = require('../common/slackBot');
const log = [];
//const debugChannel = 'C01DBP67MSQ'; // #testingbot
const debugChannel = 'C01H6RB99E2'; //Carter debug

/**
 * 
 * @param {{executionContext:{functionName:string},res:{body:any,headers:{"Content-Type":string}}}} context 
 * @param {{method:string,headers:{"user-agent":string},query:{},params:{},body:any}} req 
 */
module.exports = async function (context, req) {
    const appName = context.executionContext.functionName;
    try {
        await slackBotChatPost(debugChannel,`\n\n*Request Logged*\n\`\`\`${JSON.stringify(req,null,2)}\`\`\``);
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