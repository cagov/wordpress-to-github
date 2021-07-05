//Loading environment variables
const { Values } = require('../../wordpress-to-github-local.settings.json');
Object.keys(Values).forEach(x=>process.env[x]=Values[x]); //Load local settings file for testing

//run the indexpage async
const indexCode = require('./index');
(async () => {
   return await indexCode();
})();
