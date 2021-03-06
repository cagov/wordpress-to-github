// @ts-check

const SlackBot = require("@cagov/slack-connector");
const endpoints = require("../WordpressSync/endpoints.json");

const debugChannel = "C02G6PETB9B"; //#wordpress-sync-http-trigger

const slackBotGetToken = () => {
  const token = process.env["SLACKBOT_TOKEN"];

  if (!token) {
    //developers that don't set the creds can still use the rest of the code
    console.error(
      `You need local.settings.json to contain "SLACKBOT_TOKEN" to use slackbot features.`
    );
    return;
  }

  return token;
};

/**
 * Halts processing for a set time
 *
 * @param {number} ms milliseconds to sleep (1000 = 1s)
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @typedef {object} Response
 * @property {number} [status]
 * @property {*} [body]
 * @property {{"Content-Type":string}} [headers]
 */

/**
 * @param {{executionContext:{functionName:string},res:Response}} context
 * @param {{method:string,headers:{"user-agent":string},query?:{code?:string},params:{},body:{slug?:string,trigger?:string}}} req
 */
module.exports = async function (context, req) {
  if (req.method !== "POST") {
    context.res = {
      body: `Service is running, but is expecting a POST.`
    };
    return;
  }
  const slack = new SlackBot(slackBotGetToken(), debugChannel);

  try {
    const TriggerName = req.body?.trigger || "(Trigger)";
    const SlugName = req.body?.slug || "(slug)";
    await slack.Chat(`Notification received - ${SlugName} - ${TriggerName}`);

    //clean out "code" value display
    const redactedOutput = JSON.stringify(req, null, 2).replace(
      new RegExp(req.query.code, "g"),
      `${req.query?.code?.substring(0, 3)}[...]`
    );

    await slack.Reply(`\n\n*Full Details*\n\`\`\`${redactedOutput}\`\`\``);

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
      await slack.Reply(
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
      await slack.Reply(`Done.`);
    } else {
      await slack.Reply(`No endpoints found for...${postAgent}`);
      await slack.ReactionAdd("no_entry");
    }

    context.res = {
      status: 204 //OK - No content
    };
  } catch (e) {
    await slack.Error(e, req);

    context.res = {
      status: 500,
      body: `Error - ${e.message}`
    };
  }
};
