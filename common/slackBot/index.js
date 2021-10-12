// @ts-check
const fetchRetry = require('fetch-retry')(require('node-fetch/lib'), {retries:3,retryDelay:2000});
const slackApiChatPost = 'https://slack.com/api/chat.postMessage';
const slackApiChannelHistory = 'https://slack.com/api/conversations.history';
const slackApiChannelReplies = 'https://slack.com/api/conversations.replies';
const slackApiReaction = 'https://slack.com/api/reactions.add';

//For help building attachments...go here...
//https://api.slack.com/docs/messages/builder

const slackBotGetToken = () => {
  const token = process.env["SLACKBOT_TOKEN"];

  if (!token) {
    //developers that don't set the creds can still use the rest of the code
    console.error('You need local.settings.json to contain "SLACKBOT_TOKEN" to use slackbot features.');
    return;
  }

  return token;
};

const slackApiHeaders = {
  'Authorization' : `Bearer ${slackBotGetToken()}`,
  'Content-Type': 'application/json;charset=utf-8'
};

const slackApiPost = bodyJSON =>
    ({
        method: 'POST',
        headers: slackApiHeaders,
        body: JSON.stringify(bodyJSON)
    });
const slackApiGet = () =>
  ({
      headers: slackApiHeaders
  });

/**
 * List the post history for a channel
 * 
 * (See https://api.slack.com/methods/conversations.history)
 * 
 * @param {string} channel - Slack channel to search in
 */
const slackBotChannelHistory = async channel => 
  fetchRetry(`${slackApiChannelHistory}?channel=${channel}`,slackApiGet());

/**
 * Get a list of replies for a post
 *
 * (See https://api.slack.com/methods/conversations.replies)
 * 
 * @param {string} channel - Slack channel to search in
 * @param {string} ts - Timestamp (TS) for root Slack post
 */
const slackBotChannelReplies = async (channel,ts) => 
  fetchRetry(`${slackApiChannelReplies}?channel=${channel}&ts=${ts}`,slackApiGet());

/**
 * Add a Slack post
 *
 * (See https://api.slack.com/methods/chat.postMessage)
 *
 * (Also https://api.slack.com/docs/messages/builder)
 *
 * @param {string} channel - Slack channel to post in
 * @param {string} text - Post text
 * @param {string} [attachments] - Optional Post attachments
 */
const slackBotChatPost = async (channel,text,attachments) => {
  const payload = {
    channel,
    text,
    attachments
  };
  return fetchRetry(slackApiChatPost,slackApiPost(payload));
};
/**
 * Add a reply to a Slack post.
 *
 * @param {string} channel - Slack channel to post in
 * @param {string} thread_ts - Timestamp (TS) for Slack post
 * @param {string} text - Post text
 * @param {string} [attachments] - Optional Post attachments
 */
const slackBotReplyPost = async (channel,thread_ts,text,attachments) => {
  const payload = {
    channel,
    text,
    thread_ts,
    attachments
  };

  return fetchRetry(slackApiChatPost,slackApiPost(payload));
};

/**
 * Add a reaction to a Slack post.<br>
 *
 * (see https://api.slack.com/methods/reactions.add)
 * 
 * @param {string} channel - Slack channel to post in
 * @param {string} timestamp - Timestamp (TS) for Slack post
 * @param {string} name - emoji name
 */
const slackBotReactionAdd = async (channel,timestamp,name) => {
  const payload = {
    channel,
    timestamp,
    name
  };

  return fetchRetry(slackApiReaction,slackApiPost(payload));
};

const slackBotDelayedChatPost = async (channel,text,post_at) => {
  const payload = {
    channel,
    text,
    post_at
  };

  const fetchResp = await fetchRetry("https://slack.com/api/chat.scheduleMessage",slackApiPost(payload));
  const postInfo = await fetchResp.json();
  return postInfo;
};


/**
 * Report an error to a slack channel.
 *
 * @param {string} channel - Slack channel to post in
 * @param {string} title - the post title
 * @param {{stack:string}} errorObject - the error object to display
 * @param {*} [request] - optional request object to display
 * @param {*} [data] - optional data object to display
 */
const slackBotReportError = async (channel,title,errorObject,request,data) => {
  console.error(errorObject);

  let slackText = `${title}\n*Error Stack*\n\`\`\`${errorObject.stack}\`\`\``;

  if (request) {
    slackText += `\n\n*Request*\n\`\`\`${JSON.stringify(request,null,2)}\`\`\``;
  }
  if (data) {
    slackText += `\n\n*Data*\n\`\`\`${JSON.stringify(data,null,2)}\`\`\``;
  }

  const historyResponse = await slackBotChannelHistory(channel);
  const history = await historyResponse.json();
  const lastHourHistory = history.messages.filter(c=> 
    c.text.startsWith(`${title}\n`) 
    // @ts-ignore
    && (new Date - new Date(1000*Number(c.latest_reply || c.ts)))/1000/60/60 < 1); //last hour
  //check to see if the last post was the same title, if so make this a reply

  if(lastHourHistory && lastHourHistory.length) {
    //add to error thread
    return slackBotReplyPost(channel,lastHourHistory[0].ts,slackText);
  } else {
    //new error
    return slackBotChatPost(channel,slackText);
  }
};

module.exports = {
  slackBotChatPost,
  slackBotReplyPost,
  slackBotDelayedChatPost,
  slackBotReportError,
  slackBotChannelHistory,
  slackBotChannelReplies,
  slackBotReactionAdd
};