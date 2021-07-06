//const { slackBotChatPost, slackBotReportError, slackBotReplyPost, slackBotReactionAdd, slackBotDelayedChatPost } = require('../common/slackBot');
const { doProcessEndpoints } = require('./processEndpoints');

/**
 * Main function execution point
 */
module.exports = async () => {
  return await doProcessEndpoints();
};