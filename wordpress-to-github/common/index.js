// @ts-check
const crypto = require("crypto");
const apiPath = "/wp-json/wp/v2/";
const fetchRetry = require("fetch-retry")(require("node-fetch/lib"), {
  retries: 3,
  retryDelay: 5000,
  retryOn: [500, 502, 504]
});

/**
 * @typedef {object} SourceEndpointConfigData
 * @property {boolean} enabled
 * @property {boolean} enabledLocal
 * @property {GitHubTarget} GitHubTarget
 * @property {string} name
 * @property {string} [description]
 * @property {string} [ReportingChannel_Slack]
 * @property {WordpressSource} WordPressSource
 */

/**
 * @typedef {object} EndpointConfigData
 * @property {boolean} disabled true to ignore processing
 * @property {string[]} [ExcludeProperties] list of properties to exclude
 * @property {string} [PostPath]
 * @property {string} [PagePath]
 * @property {string} [MediaPath]
 * @property {string} [GeneralFilePath]
 * @property {boolean} [HideAuthorName] True to hide author information.
 * @property {EndpointRequestsConfigData[]} [ApiRequests]
 */

/**
 * @typedef {object} EndpointRequestsConfigData
 * @property {string} Destination
 * @property {string} Source
 * @property {string[]} [ExcludeProperties]
 */

/**
 * @typedef {{Owner:string, Repo:string, Branch:string, ConfigPath:string}} GitHubTarget
 * @typedef {{url:string,tags_exclude:string[]}} WordpressSource
 * @typedef {{width:number,path:string}} WordpressMediaSize
 */

/**
 * @typedef {object} WordpressPostRow Expected POST input when using the Wordpress API - https://developer.wordpress.org/rest-api/reference/posts/
 * @property {number} author
 * @property {number[]} categories
 * @property {string} comment_status "closed"
 * @property {string} content
 * @property {string} date
 * @property {string} date_gmt
 * @property {string} excerpt
 * @property {number} featured_media
 * @property {string} format
 * @property {string} guid
 * @property {number} id
 * @property {string} link
 * @property {*[]} meta
 * @property {string} modified
 * @property {string} modified_gmt
 * @property {string} ping_status "closed"
 * @property {string} slug
 * @property {string} status "publish"
 * @property {boolean} sticky
 * @property {number[]} tags
 * @property {string} template
 * @property {string} title
 * @property {string} type "post"
 */

/**
 * @typedef {object} WordpressPageRow Expected PAGE input when using the Wordpress API - https://developer.wordpress.org/rest-api/reference/pages/
 * @property {number} author
 * @property {number[]} [categories]
 * @property {string} comment_status "closed"
 * @property {string} content
 * @property {string} date
 * @property {string} date_gmt
 * @property {string} excerpt
 * @property {number} featured_media
 * @property {string} guid
 * @property {number} id
 * @property {string} link
 * @property {number} menu_order
 * @property {*[]} meta
 * @property {string} modified
 * @property {string} modified_gmt
 * @property {number} parent
 * @property {string} ping_status "closed"
 * @property {string} slug
 * @property {string} status "publish"
 * @property {number[]} [tags]
 * @property {string} template
 * @property {string} title
 * @property {string} type "page"
 */

/**
 * @typedef {object} WordpressMediaRow Expected MEDIA input when using the Wordpress API - https://developer.wordpress.org/rest-api/reference/media/
 * @property {number} author
 * @property {string} caption
 * @property {string} comment_status "closed"
 * @property {string} date
 * @property {string} date_gmt
 * @property {string} description
 * @property {string} guid
 * @property {number} id
 * @property {string} link
 * @property {{sizes:any}} media_details
 * @property {string} media_type "image"
 * @property {*[]} meta
 * @property {string} mime_type "image/jpeg"
 * @property {string} modified
 * @property {string} modified_gmt
 * @property {string} ping_status "closed"
 * @property {number} post
 * @property {string} slug
 * @property {string} source_url
 * @property {string} status "inherit"
 * @property {string} template
 * @property {string} title
 * @property {string} type "attachment"
 */

/**
 * @typedef {object} GithubOutputJson Expected output when pushing to github Json
 * @property {string} author
 * @property {string} date_gmt
 * @property {string} modified_gmt
 * @property {string} wordpress_url
 * @property {string[]} [categories]
 * @property {string[]} [tags]
 * @property {string} [path]
 * @property {number} [featured_media]
 * @property {{}[]} [media]
 * @property {WordpressMediaSize[]} [sizes]
 * @property {{self:{href:string}[]}} [_links]
 */

/**
 * @typedef {object} WordpressApiDateCacheItem List of most recent modifications for Wordpress objects
 * @property {string} type
 * @property {string} [modified]
 * @property {number} count
 */

/**
 * @typedef {object} WordpressApiHashCacheItem Hash details for a Wordpress API response
 * @property {string} Destination
 * @property {string} Source
 * @property {string} Hash
 */

/**
 * @typedef {object} WordpressApiHashDataItem Hash details for a Wordpress API response (With Data)
 * @property {string} Destination
 * @property {string} Source
 * @property {string} Hash
 * @property {string} Data
 */

/**
 * Get the path from the a media source url after the 'uploads' part
 *
 * @param {string} source_url
 * @example "/wp-content/uploads/2020/07/myImage.jpg" => "2020/07/myImage.jpg"
 */
const pathFromMediaSourceUrl = source_url =>
  source_url.split("/wp-content/uploads/")[1];

/**
 * Creates the META section from an edpoint
 *
 * @param {string} wordpress_source_url
 * @param {GitHubTarget} gitHubTarget
 * @param {string} object_url
 */
const commonMeta = (wordpress_source_url, gitHubTarget, object_url) => ({
  api_version: "v2",
  api_url: wordpress_source_url + apiPath,
  object_url,
  process: {
    source_code: "https://github.com/cagov/wordpress-to-github",
    source_data: wordpress_source_url,
    deployment_target: `https://github.com/${gitHubTarget.Owner}/${gitHubTarget.Repo}/tree/${gitHubTarget.Branch}`
  },
  refresh_frequency: "as needed"
});

/**
 * Replaces all strings with "rendered" properties with the value of "rendered"
 *
 * @param {*} json
 */
const wpRenderRenderFields = json => {
  for (let key of Object.keys(json)) {
    if (json[key] && (json[key]["rendered"] === "" || json[key]["rendered"])) {
      json[key] = json[key]["rendered"];
    }
  }
};

/**
 * returns a WordpressApiDateCacheItem for an object type
 *
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} objecttype page/posts/media etc
 * @returns {Promise<WordpressApiDateCacheItem>}
 */
const WpApi_GetCacheItem_ByObjectType = async (wordPressApiUrl, objecttype) => {
  const fetchResponse = await fetchRetry(
    `${wordPressApiUrl}${objecttype}?per_page=1&orderby=modified&order=desc&_fields=modified&cachebust=${Math.random()}`,
    { method: "Get" }
  );

  const result = fetchResponse.ok ? await fetchResponse.json() : [];
  if (result && result.length) {
    return {
      modified: result[0].modified,
      type: objecttype,
      count: Number(fetchResponse.headers.get("X-WP-Total"))
    };
  } else {
    return { type: objecttype, count: 0 };
  }
};

/**
 * Call the paged wordpress api query, put all the paged data into a single return array
 *
 * @param {string} fetchquery full wordpress query ready to bring back page assets
 */
const WpApi_GetPagedData_ByQuery = async fetchquery => {
  let totalpages = 1; //Will update after the first query

  const rows = [];

  for (let currentpage = 1; currentpage <= totalpages; currentpage++) {
    const fetchResponse = await fetchRetry(
      `${fetchquery}&page=${currentpage}&cachebust=${Math.random()}`,
      { method: "Get" }
    );
    if (!fetchResponse.ok) {
      throw new Error(
        `${fetchResponse.status} - ${fetchResponse.statusText} - ${fetchResponse.url}`
      );
    }
    totalpages = Number(fetchResponse.headers.get("x-wp-totalpages"));

    rows.push(...(await fetchResponse.json()));
  }

  return rows;
};

/**
 * GET something.
 *
 * @param {string} fetchquery
 * @returns
 */
const WpApi_getSomething = async fetchquery =>
  await fetchRetry(fetchquery, { method: "Get" });

/**
 * Fetch API request data from the WordPress API.
 *
 * @param {string} wordPressApiUrl Full URL to the WordPress Menu API.
 * @param {EndpointRequestsConfigData[]} requests Array of Wordpress API requests.
 * @returns {Promise<WordpressApiHashDataItem[]>}
 */
const WpApi_GetApiRequestsData = (wordPressApiUrl, requests) => {
  // Fetch all menus concurrently, shove each into array.
  return Promise.all(
    requests.map(async request => {
      const fetchquery = `${wordPressApiUrl}${request.Source}`;
      console.log(`querying Wordpress API - ${fetchquery}`);

      return await WpApi_getSomething(fetchquery)
        .then(response => {
          if (response.ok) {
            return response.json();
          } else {
            throw new Error(
              `${response.status} - ${response.statusText} - ${response.url}`
            );
          }
        })
        .then(json => removeExcludedProperties(json, request.ExcludeProperties))
        .then(json => ({
          Source: request.Source,
          Destination: request.Destination,
          Hash: crypto
            .createHash("md5")
            .update(JSON.stringify(json))
            .digest("hex"),
          Data: json
        }));
    })
  );
};

/**
 * Compares a cached object to a current object to see if the cache is out of date.
 *
 * @param {WordpressApiDateCacheItem|WordpressApiHashCacheItem} cacheItem
 * @param {WordpressApiDateCacheItem|WordpressApiHashCacheItem} currentItem
 * @returns {boolean}
 */
const jsonCacheDiscrepancy = (cacheItem, currentItem) => {
  return (
    !cacheItem || JSON.stringify(cacheItem) !== JSON.stringify(currentItem)
  );
};

/**
 * Call the paged wordpress api put all the paged data into a single return array
 *
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} objecttype page/posts/media etc
 * @example
 * await WpApi_GetPagedData_ByObjectType('https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/','posts')
 * //query https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/posts?per_page=100&orderby=slug&order=asc
 */
const WpApi_GetPagedData_ByObjectType = async (wordPressApiUrl, objecttype) => {
  const fetchquery = `${wordPressApiUrl}${objecttype}?per_page=100&orderby=slug&order=asc`;
  console.log(`querying Wordpress API - ${fetchquery}`);

  const rows = await WpApi_GetPagedData_ByQuery(fetchquery);

  //turn all "{rendered:string}"" to just "string"
  rows.forEach(r => wpRenderRenderFields(r));

  return rows;
};

/**
 * prepares WP content for storage
 *
 * @param {string} html WP html to clean
 */
const cleanupContent = html =>
  html
    .replace(/\n\n\n/g, "\n") //reduce triple spacing
    .replace(/^\n/g, ""); //remove leading CR
/**
 * fetches a dictionary object from WP
 *
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} listname the list to get
 * @returns the dictionary
 */
const fetchDictionary = async (wordPressApiUrl, listname) =>
  Object.assign(
    {},
    ...(
      await WpApi_GetPagedData_ByQuery(
        `${wordPressApiUrl}${listname}?context=embed&hide_empty=true&per_page=100&order_by=name&_fields=id,name`
      )
    ).map((/** @type {{ id: string, name: string }} */ x) => ({
      [x.id]: x.name
    }))
  );

/**
 * @param {string} wordpress_source_url
 * @param {GitHubTarget} gitHubTarget
 * @param {string} field_reference //url for field refernce
 * @param {GithubOutputJson} data
 * @param {string} object_url
 */
const wrapInFileMeta = (
  wordpress_source_url,
  gitHubTarget,
  field_reference,
  data,
  object_url
) => ({
  meta: {
    created_date: data.date_gmt,
    updated_date: data.modified_gmt,
    field_reference,
    ...commonMeta(wordpress_source_url, gitHubTarget, object_url)
  },
  data
});

/**
 * deletes properties in the list
 *
 * @param {object} json
 * @param {string[]} [excludeList]
 * @returns {object}
 */
const removeExcludedProperties = (json, excludeList) => {
  if (excludeList) {
    excludeList.forEach(x => {
      delete json[x];
    });
  }

  return json;
};

/**
 * makes sure value starts with string, prepends if it doesnt'
 *
 * @param {string} startText make sure this text appears in front
 * @param {string} value the text to look at
 */
const ensureStringStartsWith = (startText, value) =>
  (value.startsWith(startText) ? "" : startText) + value;

/**
 * Places the media section if SyncMedia is on
 *
 * @param {EndpointConfigData} endpoint
 * @param {Map <string,any> | null} mediaMap
 * @param {GithubOutputJson} jsonData
 * @param {string} HTML
 */
const addMediaSection = (endpoint, mediaMap, jsonData, HTML) => {
  if (endpoint.MediaPath && mediaMap) {
    jsonData.media = [];
    mediaMap.forEach(m => {
      //Look at media JSON only
      if (m.data && m.data.sizes) {
        m.data.sizes.forEach(s => {
          const source_url_match = HTML.includes(s.source_url);
          const featured = jsonData.featured_media === m.data.id;

          if (featured || source_url_match) {
            jsonData.media.push({
              id: m.data.id,
              ...s,
              source_url_match,
              featured
            });
          }
        });
      }
    });

    //Remove empty media array
    if (!jsonData.media.length) {
      delete jsonData.media;
    }
  }
};

module.exports = {
  ensureStringStartsWith,
  removeExcludedProperties,
  wrapInFileMeta,
  commonMeta,
  WpApi_GetCacheItem_ByObjectType,
  WpApi_GetApiRequestsData,
  jsonCacheDiscrepancy,
  apiPath,
  fetchDictionary,
  cleanupContent,
  WpApi_GetPagedData_ByObjectType,
  WpApi_getSomething,
  pathFromMediaSourceUrl,
  addMediaSection
};
