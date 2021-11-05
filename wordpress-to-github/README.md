# wordpress-to-github

A module for taking content from Wordpress instances and pushing the HTML content and JSON meta to Github.

## How does it work?

The service scans a list of WordPress projects. Each project's WordPress site is queried through the WordPress API. The service compares the objects from the API to the project's target GitHub branch. Content changes are recorded in GitHub as commits.

### Caching

The service will ask WordPress for object counts and last updated timestamps (and cache them) to determine if it should run. If you are working on the WordPress API output without updating the content itself, changes may not appear until the cache is reset.

## Config files

There are a few configuration files that need to be used.

### wordpress-to-github.config.json

Controls how the service will place content in GitHub. This file belongs in your target repo (such as [drought.ca.gov](https://github.com/cagov/drought.ca.gov/blob/main/wordpress/wordpress-to-github.config.json)).

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

## Sample output

### `general / general.json`

This file will contain global information for the WordPress istance

```json
{
  "meta": {
    "api_version": "v2",
    "api_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/",
    "object_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json?_fields=description,gmt_offset,name,namespaces,timezone_string,home,url",
    "process": {
      "source_code": "https://github.com/cagov/wordpress-to-github",
      "source_data": "https://as-go-covid19-d-001.azurewebsites.net",
      "deployment_target": "https://github.com/cagov/automation-development-target/tree/main"
    },
    "refresh_frequency": "as needed"
  },
  "data": {
    "name": "COVID-19",
    "description": "Content site for COVID-19",
    "url": "http://as-go-covid19-d-001.azurewebsites.net",
    "home": "https://as-go-covid19-d-001.azurewebsites.net",
    "gmt_offset": "0",
    "timezone_string": "",
    "namespaces": [
      "oembed/1.0",
      "wp/v2",
      "wp-site-health/v1"
    ]
  }
}
```

### `posts / [slug].json`

All posts .son files will appear next to their .html content files.

```json
{
  "meta": {
    "created_date": "2020-04-13T19:51:57",
    "updated_date": "2020-07-14T22:32:38",
    "field_reference": "https://developer.wordpress.org/rest-api/reference/posts/",
    "api_version": "v2",
    "api_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/",
    "object_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/posts/1196",
    "process": {
      "source_code": "https://github.com/cagov/wordpress-to-github",
      "source_data": "https://as-go-covid19-d-001.azurewebsites.net",
      "deployment_target": "https://github.com/cagov/automation-development-target/tree/main"
    },
    "refresh_frequency": "as needed"
  },
  "data": {
    "id": 1196,
    "date": "2020-04-13T19:51:57",
    "date_gmt": "2020-04-13T19:51:57",
    "guid": "http://as-go-covid19-d-001.azurewebsites.net/?p=1196",
    "modified": "2020-07-14T22:32:38",
    "modified_gmt": "2020-07-14T22:32:38",
    "slug": "404",
    "status": "publish",
    "type": "post",
    "link": "https://as-go-covid19-d-001.azurewebsites.net/2020/04/13/404/",
    "title": "404",
    "excerpt": "<p>We couldn&#8217;t find this page. Want to search? No pudimos encontrar esta página. Chúng tôi không thể tìm thấy trang này. لم نتمكن من العثور على هذه الصفحة. 이 페이지를 찾을 수 없습니다. 我们找不到此页面。</p>\n",
    "author": "Carter Medlin",
    "featured_media": 0,
    "comment_status": "closed",
    "ping_status": "open",
    "sticky": false,
    "template": "",
    "format": "standard",
    "meta": [],
    "categories": [
      "error page"
    ],
    "tags": [
      "do-not-crawl",
      "machine-translated"
    ],
    "wordpress_url": "https://as-go-covid19-d-001.azurewebsites.net/2020/04/13/404/"
  }
}
```

### `pages / [slug].json`

Pages work like posts, with some differences.

```json
{
  "meta": {
    "created_date": "2021-02-03T21:44:55",
    "updated_date": "2021-02-03T21:44:55",
    "field_reference": "https://developer.wordpress.org/rest-api/reference/pages/",
    "api_version": "v2",
    "api_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/",
    "object_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/pages/8932",
    "process": {
      "source_code": "https://github.com/cagov/wordpress-to-github",
      "source_data": "https://as-go-covid19-d-001.azurewebsites.net",
      "deployment_target": "https://github.com/cagov/automation-development-target/tree/main"
    },
    "refresh_frequency": "as needed"
  },
  "data": {
    "id": 8932,
    "date": "2021-02-03T21:44:55",
    "date_gmt": "2021-02-03T21:44:55",
    "guid": "http://as-go-covid19-d-001.azurewebsites.net/?page_id=8932",
    "modified": "2021-02-03T21:44:55",
    "modified_gmt": "2021-02-03T21:44:55",
    "slug": "home",
    "status": "publish",
    "type": "page",
    "link": "https://as-go-covid19-d-001.azurewebsites.net/",
    "title": "Home",
    "excerpt": "<p>homepage</p>\n",
    "author": "Aaron Hans",
    "featured_media": 0,
    "parent": 0,
    "menu_order": 0,
    "comment_status": "closed",
    "ping_status": "closed",
    "template": "",
    "meta": [],
    "wordpress_url": "https://as-go-covid19-d-001.azurewebsites.net/"
  }
}
```

### `media / [year] / [month] / [slug].json`

Media files include sizes.

```json
{
  "meta": {
    "created_date": "2020-07-14T18:55:54",
    "updated_date": "2020-07-14T18:55:54",
    "field_reference": "https://developer.wordpress.org/rest-api/reference/pages/",
    "api_version": "v2",
    "api_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/",
    "object_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/media/4826",
    "process": {
      "source_code": "https://github.com/cagov/wordpress-to-github",
      "source_data": "https://as-go-covid19-d-001.azurewebsites.net",
      "deployment_target": "https://github.com/cagov/automation-development-target/tree/main"
    },
    "refresh_frequency": "as needed"
  },
  "data": {
    "id": 4826,
    "date": "2020-07-14T18:55:54",
    "date_gmt": "2020-07-14T18:55:54",
    "guid": "/wp-content/uploads/2020/07/15485_lores.jpg",
    "modified": "2020-07-14T18:55:54",
    "modified_gmt": "2020-07-14T18:55:54",
    "slug": "15485_lores",
    "status": "inherit",
    "type": "attachment",
    "link": "https://as-go-covid19-d-001.azurewebsites.net/2020/05/11/masks-and-ppe/15485_lores/",
    "title": "15485_lores",
    "author": "Aaron Hans",
    "comment_status": "closed",
    "ping_status": "closed",
    "template": "",
    "meta": [],
    "description": "<p class=\"attachment\"><a href='/wp-content/uploads/2020/07/15485_lores.jpg'><img width=\"300\" height=\"200\" src=\"/wp-content/uploads/2020/07/15485_lores-300x200.jpg\" class=\"attachment-medium size-medium\" alt=\"\" loading=\"lazy\" srcset=\"/wp-content/uploads/2020/07/15485_lores-300x200.jpg 300w, /wp-content/uploads/2020/07/15485_lores.jpg 700w\" sizes=\"(max-width: 300px) 100vw, 300px\" /></a></p>\n",
    "caption": "",
    "alt_text": "",
    "media_type": "image",
    "mime_type": "image/jpeg",
    "media_details": {
      "width": 700,
      "height": 466,
      "file": "2020/07/15485_lores.jpg",
      "sizes": {
        "medium": {
          "file": "15485_lores-300x200.jpg",
          "width": 300,
          "height": 200,
          "mime_type": "image/jpeg",
          "source_url": "/wp-content/uploads/2020/07/15485_lores-300x200.jpg"
        },
        "thumbnail": {
          "file": "15485_lores-150x150.jpg",
          "width": 150,
          "height": 150,
          "mime_type": "image/jpeg",
          "source_url": "/wp-content/uploads/2020/07/15485_lores-150x150.jpg"
        },
        "full": {
          "file": "15485_lores.jpg",
          "width": 700,
          "height": 466,
          "mime_type": "image/jpeg",
          "source_url": "/wp-content/uploads/2020/07/15485_lores.jpg"
        }
      },
      "image_meta": {
        "aperture": "0",
        "credit": "",
        "camera": "",
        "caption": "",
        "created_timestamp": "0",
        "copyright": "",
        "focal_length": "0",
        "iso": "0",
        "shutter_speed": "0",
        "title": "",
        "orientation": "0",
        "keywords": []
      }
    },
    "post": 2997,
    "source_url": "/wp-content/uploads/2020/07/15485_lores.jpg",
    "wordpress_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-content/uploads/2020/07/15485_lores.jpg",
    "sizes": [
      {
        "type": "full",
        "path": "2020/07/15485_lores.jpg",
        "wordpress_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-content/uploads/2020/07/15485_lores.jpg",
        "file": "15485_lores.jpg",
        "width": 700,
        "height": 466,
        "mime_type": "image/jpeg",
        "source_url": "/wp-content/uploads/2020/07/15485_lores.jpg"
      },
      {
        "type": "medium",
        "path": "2020/07/15485_lores-300x200.jpg",
        "wordpress_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-content/uploads/2020/07/15485_lores-300x200.jpg",
        "file": "15485_lores-300x200.jpg",
        "width": 300,
        "height": 200,
        "mime_type": "image/jpeg",
        "source_url": "/wp-content/uploads/2020/07/15485_lores-300x200.jpg"
      },
      {
        "type": "thumbnail",
        "path": "2020/07/15485_lores-150x150.jpg",
        "wordpress_url": "https://as-go-covid19-d-001.azurewebsites.net/wp-content/uploads/2020/07/15485_lores-150x150.jpg",
        "file": "15485_lores-150x150.jpg",
        "width": 150,
        "height": 150,
        "mime_type": "image/jpeg",
        "source_url": "/wp-content/uploads/2020/07/15485_lores-150x150.jpg"
      }
    ],
    "path": "2020/07/15485_lores.jpg"
  }
}
```