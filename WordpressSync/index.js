// @ts-check
const { SyncEndpoint } = require("../wordpress-to-github");
const {
  GitHubCommitter,
  GitHubCredentials
} = require("../wordpress-to-github/common");
const {
  slackBotReportError,
  slackBotChatPost,
  slackBotReplyPost,
  slackBotReactionAdd
} = require("../common/slackBot");
//const debugChannel = "C01DBP67MSQ"; // #testingbot
const debugChannel = "C01H6RB99E2"; //Carter debug
const endPointsJson = require("./endpoints.json");
const endpoints = endPointsJson.data.projects;
/** @type {GitHubCommitter} **/
const gitHubCommitter = {
  name: `${process.env["GITHUB_NAME"]}`,
  email: `${process.env["GITHUB_EMAIL"]}`
};
/** @type {GitHubCredentials} **/
const gitHubCredentials = {
  token: `${process.env["GITHUB_TOKEN"]}`
};

/**
 *
 * @param {{executionContext:{functionName:string}}} context
 * @param {*} myTimer
 */
module.exports = async function (context, myTimer) {
  const appName = context.executionContext.functionName;
  const debugMode = process.env.debug?.toLowerCase() === "true";

  if (debugMode) {
    await doProcessEndpoints();
    return;
  }

  try {
    await doProcessEndpoints();
  } catch (e) {
    await slackBotReportError(
      debugChannel,
      `Error running ${appName}`,
      e,
      context,
      myTimer
    );
  }
};

const doProcessEndpoints = async () => {
  const debugMode = process.env.debug?.toLowerCase() === "true";

  const work = endpoints.filter(
    x => (debugMode && x.enabledLocal) || (!debugMode && x.enabled)
  );

  if (!work.length) {
    console.error(
      `No endpoints selected.  For debug mode you should set at least one "enabledLocal" to true.`
    );
  }

  for (const endpoint of work) {
    console.log(`*** Checking endpoint for ${endpoint.name} ***`);

    const report = await SyncEndpoint(
      endpoint.GitHubTarget,
      gitHubCredentials,
      gitHubCommitter
    );

    if (report.length) {
      if (endpoint.ReportingChannel_Slack) {
        for (const commitReport of report) {
          const filenames = [
            ...new Set(
              commitReport.Files.map(
                x => x.filename.split("/").slice(-1)[0].split(".")[0]
              )
            )
          ].sort();

          let slackPostTS = (
            await (
              await slackBotChatPost(
                endpoint.ReportingChannel_Slack,
                `${endpoint.name} - ${filenames.join(", ")}`
              )
            ).json()
          ).ts;

          await slackBotReplyPost(
            endpoint.ReportingChannel_Slack,
            slackPostTS,
            `*${commitReport.Commit.message}*/n${commitReport.Commit.html_url}`
          );
        }
      }

      const x = report;
    }
  }
};
