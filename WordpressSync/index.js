const { doProcessEndpoints } = require('./processEndpoints');
const { slackBotReportError } = require('../common/slackBot');
const debugChannel = 'C01DBP67MSQ'; // #testingbot
//const debugChannel = 'C01H6RB99E2'; //Carter debug

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