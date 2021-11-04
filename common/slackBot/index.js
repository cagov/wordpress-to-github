//@ts-check
const fetch = require("fetch-retry")(require("node-fetch/lib"), {
  retries: 3,
  retryDelay: 2000
});
const slackApiChatPost = "https://slack.com/api/chat.postMessage";
const slackApiChannelHistory = "https://slack.com/api/conversations.history";
const slackApiChannelReplies = "https://slack.com/api/conversations.replies";
const slackApiReaction = "https://slack.com/api/reactions.add";

//For help building attachments...go here...
//https://api.slack.com/docs/messages/builder

/**
 * @typedef {object} slackBotChatOptions
 * @property {boolean} [as_user] Pass true to post the message as the authed user, instead of as a bot. Defaults to false.
 * @property {*[]} [attachments] A JSON-based array of structured attachments, presented as a URL-encoded string.
 * @property {*[]} [blocks] A JSON-based array of structured blocks, presented as a URL-encoded string.
 * @property {string} [icon_emoji] Emoji to use as the icon for this message. Overrides icon_url. Must be used in conjunction with as_user set to false, otherwise ignored.
 * @property {string} [icon_url] URL to an image to use as the icon for this message. Must be used in conjunction with as_user set to false, otherwise ignored.
 * @property {boolean} [link_names] Find and link channel names and usernames.
 * @property {boolean} [mrkdwn] Disable Slack markup parsing by setting to false. Enabled by default. Default: true
 * @property {string} [parse] Change how messages are treated. Defaults to none.
 * @property {boolean} [reply_broadcast] Used in conjunction with thread_ts and indicates whether reply should be made visible to everyone in the channel or conversation. Defaults to false.
 * @property {boolean} [unfurl_links] Pass true to enable unfurling of primarily text-based content.
 * @property {boolean} [unfurl_media] Pass false to disable unfurling of media content.
 * @property {string} [username] Set your bot's user name. Must be used in conjunction with as_user set to false, otherwise ignored.
 */

/**
 * @typedef {object} slackChatResultMessage
 * @property {string} bot_id
 * @property {{app_id:string,deleted:boolean,icons:*,id:string,name:string,team_id:string,updated:number}} [bot_profile]
 * @property {{emoji:string,image_64:string}} [icons]
 * @property {string} [subtype]
 * @property {string} [team]
 * @property {string} text
 * @property {string} [thread_ts]
 * @property {string} ts
 * @property {string} type
 * @property {string} [username]
 * @property {string} [user]
 */

/**
 * @typedef {object} slackChatResult
 * @property {boolean} ok
 * @property {string} ts
 * @property {string} channel
 * @property {slackChatResultMessage} message
 */

/**
 * Checks for a slack response json and throws an error if it finds one
 * @param {Response} response fetch response
 */
const getSlackJsonResponse = async response => {
  if (response.ok) {
    const json = await response.json();
    if (json.ok) {
      return json;
    } else {
      throw new Error(`Slack Error : ${JSON.stringify(json, null, 2)}`);
    }
  } else {
    throw new Error(
      `Slack Connection Error : ${response.status} - ${response.statusText}`
    );
  }
};

class slackBot {
  /**
   * @param {string} token
   * @param {string} channel
   * @param {slackBotChatOptions} [defaultOptions]
   */
  constructor(token, channel, defaultOptions) {
    /** @type {string} */
    this.channel = channel;
    /** @type {string} */
    this.token = token;
    /** @type {slackBotChatOptions} */
    this.defaultOptions = defaultOptions;

    /** @type {string} */
    this.ts = "";
    /** @type {string} */
    this.thread_ts = "";

    /**
     * API Headers with token
     */
    this.slackApiHeaders = () => ({
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json;charset=utf-8"
    });

    /**
     * fetch settings for an API POST
     * @param {*} bodyJSON JSON to POST
     */
    this.slackApiPost = bodyJSON => ({
      method: "POST",
      headers: this.slackApiHeaders(),
      body: JSON.stringify(bodyJSON)
    });

    /**
     * fetch settings for an API GET
     */
    this.slackApiGet = () => ({
      headers: this.slackApiHeaders()
    });

    /**
     * Add a Slack post
     *
     * (See https://api.slack.com/methods/chat.postMessage)
     *
     * (Also https://api.slack.com/docs/messages/builder)
     * @param {string} text
     * @param {slackBotChatOptions} [options] - Optional options
     */
    this.Chat = async (text, options) => {
      const payload = {
        channel: this.channel,
        text,
        ...defaultOptions,
        ...options
      };

      const response = await fetch(
        slackApiChatPost,
        this.slackApiPost(payload)
      );
      /** @type {slackChatResult} */
      const json = await getSlackJsonResponse(response);
      this.thread_ts = json.ts;
      this.ts = json.ts;
      return json;
    };

    /**
     * Add a reply to the last Slack post.
     * @param {string} text
     * @param {slackBotChatOptions} [options] - Optional options
     */
    this.Reply = async (text, options) => {
      if (this.thread_ts) {
        const payload = {
          channel: this.channel,
          text,
          thread_ts: this.thread_ts,
          ...defaultOptions,
          ...options
        };
        const response = await fetch(
          slackApiChatPost,
          this.slackApiPost(payload)
        );

        /** @type {slackChatResult} */
        const json = await getSlackJsonResponse(response);
        this.ts = json.ts;
        this.thread_ts = json.message.thread_ts;
        return json;
      } else {
        return await this.Chat(text, options);
      }
    };

    /**
     * Send error details to the channel
     * @param {Error} e The Error object that was caught
     * @param {*} [data] Any data that should be added to the exception log
     * @param {slackBotChatOptions} [options] - Optional options
     */
    this.Error = async (e, data, options) => {
      if (!this.thread_ts) {
        await this.Chat(`Error - _${e.message}_`, options);
      }

      let message = `*Error Stack*\n\`\`\`${e.stack}\`\`\``;
      if (data) {
        message += `\n*Data*\n\`\`\`${JSON.stringify(data, null, 2)}\`\`\``;
      }

      return await this.Reply(message, options);
    };

    /**
     * Add a reaction to the last Slack post.<br>
     *
     * (see https://api.slack.com/methods/reactions.add)
     *
     * @param {string} name - emoji name
     */
    this.ReactionAdd = async name => {
      const payload = {
        channel: this.channel,
        timestamp: this.ts,
        name
      };
      const response = await fetch(
        slackApiReaction,
        this.slackApiPost(payload)
      );
      return await getSlackJsonResponse(response);
    };

    /**
     * Returns a clone.  Usefull for keeping track of an original timestamp
     */
    this.Clone = () => {
      const copied = new slackBot(
        this.token,
        this.channel,
        this.defaultOptions
      );
      copied.thread_ts = this.thread_ts;
      copied.ts = this.ts;

      return copied;
    };
  }
}

module.exports = slackBot;
