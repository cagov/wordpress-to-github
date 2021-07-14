const { SyncEndpoint } = require('./processEndpoints');
const { slackBotReportError } = require('../common/slackBot');
const debugChannel = 'C01DBP67MSQ'; // #testingbot
//const debugChannel = 'C01H6RB99E2'; //Carter debug
const endpoints = require('./v2endpoints.json').data;
const gitHubCommitter = {
  name: process.env["GITHUB_NAME"],
  email: process.env["GITHUB_EMAIL"]
};
const gitHubCredentials = { 
  token: process.env["GITHUB_TOKEN"] 
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
    await doProcessEndpoints();
    return;
  }

  try {
    await doProcessEndpoints();
  } catch (e) {
    await slackBotReportError(debugChannel,`Error running ${appName}`,e,context,myTimer);
  }
};

const doProcessEndpoints = async () => {
  const debugMode = process.env.debug?.toLowerCase()==='true';

  for(const endpoint of endpoints.projects.filter(x=>debugMode && x.enabledLocal || !debugMode && x.enabled)) {
    console.log(`*** Checking endpoint for ${endpoint.name} ***`);
    await SyncEndpoint(endpoint, gitHubCredentials, gitHubCommitter);
  }
};