// @ts-check
const { SyncEndpoint } = require("@cagov/wordpress-to-github");
const {
  GitHubCommitter,
  GitHubCredentials,
  SourceEndpointConfigData
} = require("@cagov/wordpress-to-github/common");
const {
  slackBotReportError,
  slackBotChatPost,
  slackBotReplyPost
} = require("../common/slackBot");
const debugChannel = "C01DBP67MSQ"; // #testingbot
//const debugChannel = 'C01H6RB99E2'; //Carter debug
const endPointsJson = require("./endpoints.json");
/** @type {SourceEndpointConfigData[]} */
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
 * @param {*} [myTimer]
 * @param {string[]} [activeEndpoints] list of endpoints to run
 */
module.exports = async function (context, myTimer, activeEndpoints) {
  const endpointsFiltered = [...endpoints].filter(
    x => !activeEndpoints?.length || activeEndpoints.includes(x.name)
  );

  const appName = context.executionContext.functionName;
  const debugMode = process.env.debug?.toLowerCase() === "true";

  const work = endpointsFiltered.filter(
    x => (debugMode && x.enabledLocal) || (!debugMode && x.enabled)
  );

  if (debugMode) {
    await doProcessEndpoints(work);
    return;
  }

  try {
    await doProcessEndpoints(work);
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

/**
 *
 * @param {SourceEndpointConfigData[]} work
 */
const doProcessEndpoints = async work => {
  if (work.length) {
    console.log(`Using ${work.length} endpoint(s)`);
  } else {
    console.error(
      `No endpoints selected.  For debug mode you should set at least one "enabledLocal" to true.`
    );
  }

  for (const endpoint of work) {
    console.log(`*** Checking endpoint for ${endpoint.name} ***`);

    const commitReports = await SyncEndpoint(
      endpoint.GitHubTarget,
      endpoint,
      gitHubCredentials,
      gitHubCommitter
    );

    if (endpoint.ReportingChannel_Slack) {
      //Endpoint reporting channel enabled.  Add a post for each commit report.
      if (commitReports?.length) {
        /** @type {string[]} */
        let mergeFileNames = [];
        commitReports.map(x => {
          mergeFileNames.push(
            ...x.Files.map(
              //Remove file extension, and remove resolution postfix
              x =>
                x.filename
                  .split("/")
                  .slice(-1)[0]
                  .split(".")[0]
                  .replace(/-\d+x\d+$/, "")
            )
          );
        });

        const allfileNames = [...new Set(mergeFileNames)];

        const slackPostTS = (
          await (
            await slackBotChatPost(
              endpoint.ReportingChannel_Slack,
              `${endpoint.name} - _${allfileNames.join(", ")}_`
            )
          ).json()
        ).ts;

        for (const commitReport of commitReports) {
          const fileData = commitReport.Files.map(
            x => `• ${x.status} - _${x.filename.split("/").slice(-1)[0]}_`
          ).join("\n");

          await slackBotReplyPost(
            endpoint.ReportingChannel_Slack,
            slackPostTS,
            `<${commitReport.Commit.html_url}|${commitReport.Commit.message}>\n${fileData}`
          );
        }
      }
    }
  }
};
