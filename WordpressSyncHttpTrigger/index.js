// @ts-check
const { GitHubTarget } = require("@cagov/wordpress-to-github/common");
const { sleep } = require("@cagov/wordpress-to-github/gitTreeCommon");
const {
  slackBotReportError,
  slackBotChatPost,
  slackBotReplyPost,
  slackBotReactionAdd
} = require("../common/slackBot");
const endpoints = require("../WordpressSync/endpoints.json");

const debugChannel = "C02G6PETB9B"; //#wordpress-sync-http-trigger

const gitHubCommitter = {
  name: process.env["GITHUB_NAME"],
  email: process.env["GITHUB_EMAIL"]
};
const gitHubCredentials = {
  token: process.env["GITHUB_TOKEN"]
};

/**
 * @typedef {object} Response
 * @property {number} [status]
 * @property {*} [body]
 * @property {{"Content-Type":string}} [headers]
 */

/**
 * @param {{executionContext:{functionName:string},res:Response}} context
 * @param {{method:string,url:string,headers:{"user-agent":string,host:string},query:{code?:string},params:{},body:GitHubTarget}} req
 */
module.exports = async function (context, req) {
  const appName = context.executionContext?.functionName;
  try {
    if (req.method !== "POST") {
      context.res = {
        body: `Service is running, but is expecting a POST.`
      };
      return;
    }

    let slackPostTS = "";

    const TriggerName = req.body["trigger"] || "(Trigger)";
    const SlugName = req.body["slug"] || "(slug)";
    slackPostTS = (
      await (
        await slackBotChatPost(
          debugChannel,
          `Notification received - ${SlugName} - ${TriggerName}`
        )
      ).json()
    ).ts;

    const debugOutput = {
      "user-agent": req.headers["user-agent"],
      host: req.headers.host,
      url: req.url,
      "x-original-url": req.headers["x-original-url"],
      body: req.body
    };

    //clean out "code" value display
    const redactedOutput = JSON.stringify(debugOutput, null, 2).replace(
      new RegExp(req.query.code, "g"),
      `${req.query?.code?.substring(0, 3)}[...]`
    );

    await slackBotReplyPost(
      debugChannel,
      slackPostTS,
      `\n\n*Details*\n\`\`\`${redactedOutput}\`\`\``
    );

    //Find endpoints that match the requestor
    const postAgent = req.headers["user-agent"];
    const activeEndpoints = endpoints.data.projects.filter(
      x =>
        x.enabled &&
        x.WordPressSource?.url &&
        postAgent.includes(x.WordPressSource.url)
    );

    //if you find matches...congrats...report for now
    if (activeEndpoints.length) {
      await slackBotReplyPost(
        debugChannel,
        slackPostTS,
        `${
          activeEndpoints.length
        } matching endpoint(s) found ...${activeEndpoints
          .map(x => x.name)
          .join(", ")}`
      );

      await sleep(10 * 1000); // let's wait 10 seconds before processing to try to avoid sync issues with the WP database

      //run the indexpage async
      const indexCode = require("../WordpressSync");
      await indexCode(
        {
          executionContext: {
            functionName: "WordpressSyncHttpTrigger"
          }
        },
        null,
        activeEndpoints.map(x => x.name)
      );
      await slackBotReplyPost(debugChannel, slackPostTS, `Done.`);
    } else {
      await slackBotReplyPost(
        debugChannel,
        slackPostTS,
        `No endpoints found for...${postAgent}`
      );
      await slackBotReactionAdd(debugChannel, slackPostTS, "no_entry");
    }

    context.res = {
      status: 204 //OK - No content
    };
  } catch (e) {
    await slackBotReportError(
      debugChannel,
      `Error running ${appName}`,
      e,
      context,
      null
    );

    context.res = {
      status: 500,
      body: `Error - ${e.message}`
    };
  }
};
