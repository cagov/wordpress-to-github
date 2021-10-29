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
  try {
    throw new Error("error test");
    slackPostTS = (
      await (
        await slackBotChatPost(
          debugChannel,
          `\n\n*Full Details*\n\`\`\`${JSON.stringify(req, null, 2)}\`\`\``
        )
      ).json()
    ).ts;

    context.res = {
      body: `${JSON.stringify(req, null, 2)}`
    };
  } catch (e) {
    await slackBotReplyPost(
      debugChannel,
      slackPostTS,
      `\n\n*Full Details*\n\`\`\`${JSON.stringify(req, null, 2)}\`\`\``
    );

    context.res = {
      status: 500,
      body: `Error - ${e.message}`
    };
  }
};
