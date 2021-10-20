# wordpress-to-github

A service for taking content from Wordpress instances and pushing the HTML content and JSON meta to Github.

## How does it work?

The service scans a list of WordPress projects. Each project's WordPress site is queried through the WordPress API. The service compares the objects from the API to the project's target GitHub branch. Content changes are recorded in GitHub as commits.

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
