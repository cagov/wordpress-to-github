// @ts-check
const {
  slackBotReportError,
  slackBotChatPost,
  slackBotReplyPost,
  slackBotReactionAdd
} = require("../common/slackBot");
const debugChannel = "C01H6RB99E2"; //#carter-dev

module.exports = async function (context, req) {
  const appName = context.executionContext?.functionName;
  let slackPostTS = "";

  const debugInfo = {
    context,
    req
  };

  try {
    slackPostTS = (
      await (await slackBotChatPost(debugChannel, "Work recorded")).json()
    ).ts;

    await slackBotReplyPost(
      debugChannel,
      slackPostTS,
      `\n\n*Request Info*\n\`\`\`${JSON.stringify(req, null, 2)}\`\`\``
    );

    const yo = require("@cagov/wordpress-to-github");

    context.res = {
      body: `${JSON.stringify(req, null, 2)}`
    };
  } catch (e) {
    await slackBotReplyPost(
      debugChannel,
      slackPostTS,
      `\n\n*Error Details*\n\`\`\`${JSON.stringify(e.stack, null, 2)}\`\`\``
    );

    context.res = {
      status: 500,
      body: `Error - ${e.message}\n${e.stack}`
    };
  }
};
