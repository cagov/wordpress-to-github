# wordpress-to-github

A service for taking content from Wordpress instances and pushing the HTML content and JSON meta to Github.

## How does it work?

The service scans a list of WordPress projects. Each project's WordPress site is queried through the WordPress API. The service compares the objects from the API to the project's target GitHub branch. Content changes are recorded in GitHub as commits.

### Caching

The service will ask WordPress for object counts and last updated timestamps (and cache them) to determine if it should run. If you are working on the WordPress API output without updating the content itself, changes may not appear until the cache is reset.

## Setting up Local Execution

When using Visual Studio Code, you can run the polling service locally. Only projects with `enabledLocal: true` will run. It is recommended that you keep all projects set to `enabledLocal: false` until you are sure you want to run them. The `RUN AND DEBUG` launch menu in VS Code should contain `Debug DIRECT WordpressSync`; use that to run locally with debugging.

You will need to define a `local.settings.json` file in the project root with the following options.

```json
{
  ...
  "Values": {
    ...
    "GITHUB_NAME": "...Your GitHub Name...",
    "GITHUB_EMAIL": "...Your GitHub Email...",
    "GITHUB_TOKEN": "...Your GitHub API Token...",
    "SLACKBOT_TOKEN":"...Your Slackbot API Token..."
    ...
  }
}
```

`GITHUB_NAME` : The name that will appear on commits.

`GITHUB_EMAIL` : The email that will appear on commits.

`GITHUB_TOKEN` : Your token used to authenticate with GitHub. Get one [here](https://github.com/settings/tokens).

`SLACKBOT_TOKEN` : Your token used to authenticate with your Slack app. Make one [here](https://api.slack.com/apps/).

## Components

### WordpressSync

An Azure Function as as Service (FaaS) site that operates on a Cron schedule to poll Wordpress sites for processing.

### WordpressSyncHttpTrigger

An Azure Function as as Service (FaaS) site that can be the target for update notifications. Wordpress sites can be configured to hit this service when changes are made to trigger updates without waiting for the polling service.

### wordpress-to-github

The core features that will eventually be extracted to be an NPM package.

## Config files

There are a few configuration files that need to be used.

### wordpress-to-github.config.json

Controls how the service will place content in GitHub.

```json
{
  "$schema": "https://raw.githubusercontent.com/cagov/wordpress-to-github/main/wordpress-to-github/schemas/wordpress-to-github.config.schema.json",
  "meta": {
    "title": "wordpress-to-github endpoints config file",
    "description": "wordpress-to-github endpoints config file"
  },
  "data": {
    "disabled": false,
    "PostPath": "wordpress/posts",
    "PagePath": "wordpress/pages",
    "MediaPath": "wordpress/media",
    "GeneralFilePath": "wordpress/general/general.json",
    "ExcludeProperties": ["content", "_links"]
  }
}
```

`disabled`
: Set to true to disable processing for this project.

`PostPath`
: Where should the posts go?

`PagePath`
: Where should the pages go?

`MediaPath`
: Where should image media go?

`GeneralFilePath`
: The full path and filename for a `general.json` file that contains information about the whole site.

`ExcludeProperties`
: Which WordPress properties should we suppress in output?

### endpoints.json

Contains the projects to process with the service.

```json
{
  "$schema": "./endpoints.schema.json",
  "meta": {
    "title": "endpoints config file",
    "description": "endpoints config file"
  },
  "data": {
    "projects": [
      {
        "name": "drought.ca.gov",
        "description": "Drought production website",
        "enabled": true,
        "enabledLocal": false,
        "ReportingChannel_Slack": "C1234567890",
        "WordPressSource": {
          "url": "https://live-drought-ca-gov.pantheonsite.io",
          "tags_exclude": ["staging", "development"]
        },
        "GitHubTarget": {
          "Owner": "cagov",
          "Repo": "drought.ca.gov",
          "Branch": "main",
          "ConfigPath": "wordpress/wordpress-to-github.config.json"
        }
      }
    ]
  }
}
```

`name` : Friendly name for this job when it runs locally.

`description` : Describe what this is being used for in this endpoint configuration.

`enabled` : Should we process this endpoint?

`enabledLocal` : Should we process this endpoint when running in local development?

`ReportingChannel_Slack` : Slack channel to report activity to.

`WordPressSource` : Describes the Wordpress instance to read from.

`url` : URL of the Wordpress instance to read from.

`tags_exclude` : Ignore Pages/Posts with these tags (Case sensitive!).

`GitHubTarget` : The endpoint target to deploy changes.

`Owner` : GitHub Owner.

`Repo` : GitHub Repo.

`Branch` : GitHub Target Branch.

`ConfigPath` : Path to config.json file for this endpoint.

## Debugging

Running this project locally is a good way to see exactly what it is querying, what it decides to update and what commits it creates.

Follow the instructions above in the "Setting up Local Execution" section.

The config file WordpressSync/endpoints/json contains the list of all endpoints to be reviewed and which repos to push content updates to. The enabledLocal on every one of these is set to false by default.

If you run this project locally in VSCode while all the endpoints have enabledLocal: false it will stop execution after reviewing that file with a message that you need to enable at least one endpoint to make updates.

Execute this locally in VSCode by:

- Selecting the debug section in the sidebar (triangle with bug icon)
- Choosing Debug DIRECT WordpressSync from the pulldown menu at the top of the right sidebar
- Clicking the triangle next to your pulldown selection to begin execution

Executing the code on a live endpoint will behave exactly as this does in production, it will check for updates at the server endpoint, create a commit of these changes to the target repository specified in endpoints.json and send slack notifications to the channel specified.

These commits will be performed with the account associated with your github token in your local.settings.json file. The local.settings.json file is gitignored and never committed to the repository. If it were accidentally committed github would immediately invalidate the exposed token and notify the committer. Individuals without access to accounts with permission to commit directly to the associated repo will not be able to create tokens the service can use to commit changes.

Slack messages can be redirected to your own debug channels by changing the channel id or disabled by removing the ReportingChannel_Slack value from the object which you have enabledLocal: true.

When an endpoint is enabled it will be queried 3 times, the VSCode command line console will show the running function's log output which will list the endpoints it is reviewing for updates. It queries WordPress for media, posts and pages.

If an update is discovered the service will create a commit and logs will print a link to the commit created on github.

If no update is discovered no further output is displayed.

This service is executing in its production FAAS instance on a 2 minute timer. Running it locally will be performing the same actions occuring constantly in production against the same endpoints and github repos defined in the endpoints.json file.
