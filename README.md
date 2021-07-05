# wordpress-to-github
A tool for taking content from Wordpress instances and pushing the content and json meta to Github.


## Running locally
1. Checkout this git repo
2. Run `npm install`
3. Create key file one level up from the repo: `wordpress-to-github-local.settings.json`
```
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "GITHUB_EMAIL": "---",
    "GITHUB_NAME": "---",
    "GITHUB_TOKEN": "---"
  }
}
```
Use your own github credentials & create a Personal Access Token

4. Run debugger, this will update the repo `node ./WordpressSync/debug.js`.
   * To limit which repos you are writing to, you can locally alter the endpoints file.