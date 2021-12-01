//Loading environment variables
const { Values } = require("../local.settings.json");
Object.keys(Values).forEach(x => (process.env[x] = Values[x])); //Load local settings file for testing

process.env.debug = true; //set to false or remove to run like the real instance
const repeatCount = parseInt(process.argv.slice(2));

//run the indexpage async
const indexCode = require("./index");
(async () => {
  for (let step = 0; step < repeatCount; step++) {
    console.log(`****** Iteration ${step + 1} ******`);
    await indexCode({ executionContext: { functionName: "debug" } }, null, []);
  }
})();
