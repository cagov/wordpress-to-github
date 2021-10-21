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
