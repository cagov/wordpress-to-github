// @ts-check
const { SyncEndpoint } = require('../wordpress-to-github');
const { slackBotReportError } = require('../common/slackBot');
const { reportError } = require('../common/reportError');
const debugChannel = 'C01DBP67MSQ'; // #testingbot
//const debugChannel = 'C01H6RB99E2'; //Carter debug
const endPointsJson = require('./endpoints.json')
const endpoints = endPointsJson.data.projects;
/** @type {import('../wordpress-to-github/common').GitHubCommitter} **/
const gitHubCommitter = {
  name: `${process.env["GITHUB_NAME"]}`,
  email: `${process.env["GITHUB_EMAIL"]}`
};
/** @type {import('../wordpress-to-github/common').GitHubCredentials} **/
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
  const debugMode = process.env.debug?.toLowerCase()==='true';

  if(debugMode) {
    try {
      await doProcessEndpoints();
    } catch (e) {
      console.log(`Error running ${appName}`,e);
      reportError(`Error running ${appName}`,e,context,myTimer, {type: "console"});
    }
  }

  try {
    await doProcessEndpoints();
  } catch (e) {
    await slackBotReportError(debugChannel,`Error running ${appName}`,e,context,myTimer);
  }
};

const doProcessEndpoints = async () => {
  const debugMode = process.env.debug?.toLowerCase()==='true';

  for(const endpoint of endpoints.filter(x=>debugMode && x.enabledLocal || !debugMode && x.enabled)) {
    console.log(`*** Checking endpoint for ${endpoint.name} ***`);
    await SyncEndpoint(endpoint.GitHubTarget, gitHubCredentials, gitHubCommitter);
  }
};