
/**
* Report an error to debugger.
* @param {string} title - the post title
* @param {{stack:string}} errorObject - the error object to display
* @param {*} [request] - optional request object to display
* @param {*} [data] - optional data object to display
* @param {*} {{channel:string, type:string}} - options for routing the error response
*/
const reportError = async (title,errorObject,request,data,options) => {
  console.error(errorObject);

  let messageText = `${title}\n*Error Stack*\n\`\`\`${errorObject.stack}\`\`\``;

  if (request) {
    messageText += `\n\n*Request*\n\`\`\`${JSON.stringify(request,null,2)}\`\`\``;
  }
  if (data) {
    messageText += `\n\n*Data*\n\`\`\`${JSON.stringify(data,null,2)}\`\`\``;
  }

  // if (options && options.type === 'Slack') {
  //   const historyResponse = await messageBotChannelHistory(channel);
  //   const history = await historyResponse.json();
  //   const lastHourHistory = history.messages.filter(c=> 
  //     c.text.startsWith(`${title}\n`) 
  //     // @ts-ignore
  //     && (new Date - new Date(1000*Number(c.latest_reply || c.ts)))/1000/60/60 < 1); //last hour
  //   //check to see if the last post was the same title, if so make this a reply
  
  //   if(lastHourHistory && lastHourHistory.length) {
  //     //add to error thread
  //     return messageBotReplyPost(channel,lastHourHistory[0].ts,messageText);
  //   } else {
  //     //new error
  //     return messageBotChatPost(channel,messageText);
  //   }
  // }

  // Output to console
  console.log(messageText);

};

module.exports = {
  reportError
};