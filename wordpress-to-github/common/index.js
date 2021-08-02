// @ts-check
const apiPath = '/wp-json/wp/v2/';
const { gitHubBlobPredictShaFromBuffer } = require('../gitTreeCommon');
const fetch = require('node-fetch');
// @ts-ignore
const fetchRetry = require('fetch-retry')(fetch);

/**
* @typedef {Object} Endpoint
* @property {boolean} [disabled] true to ignore processing
* @property {string} WordPressUrl The Wordpress starting point URL
* @property {string[]} [ExcludeProperties] list of properties to exclude
* @property {string[]} [tags] positive list of tags to limit sync to
* @property {string[]} [tags_exclude] negative list of tags to signal ignoring an object
* @property {string} [PostPath]
* @property {string} [PagePath]
* @property {string} [MediaPath]

* @typedef {Object} EndpointConfigData
* @property {Endpoint} wordpress_to_github_config
* @property {Endpoint[]} [supplemental_configs]

* @typedef {{Owner:string, Repo:string, Branch:string, ConfigPath:string}} GitHubTarget
* @typedef {{name:string, email:string}} GitHubCommitter
* @typedef {{token:string}} GitHubCredentials

* @typedef {{width:number,path:string}} WordpressMediaSize

* @typedef {Object} WordpressPostRow Expected POST input when using the Wordpress API - https://developer.wordpress.org/rest-api/reference/posts/
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
* @property {[]} meta
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

* @typedef {Object} WordpressPageRow Expected PAGE input when using the Wordpress API - https://developer.wordpress.org/rest-api/reference/pages/
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
* @property {[]} meta
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

* @typedef {Object} WordpressMediaRow Expected MEDIA input when using the Wordpress API - https://developer.wordpress.org/rest-api/reference/media/
* @property {number} author
* @property {string} caption
* @property {string} comment_status "closed"
* @property {string} date
* @property {string} date_gmt
* @property {string} description
* @property {string} guid
* @property {number} id
* @property {string} link
* @property {{sizes:WordpressMediaSize[]}} media_details
* @property {string} media_type "image"
* @property {[]} meta
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

* @typedef {Object} GithubOutputJson Expected output when pushing to github Json
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

* @typedef {Object} WordpressApiDateCacheItem List of most recent modifications for Wordpress objects
* @property {string} type
* @property {string} modified
* @property {number} count
*/

/**
 * Get the path from the a media source url after the 'uploads' part
 * @param {string} source_url
 * @example "/wp-content/uploads/2020/07/myImage.jpg" => "2020/07/myImage.jpg"
 */
const pathFromMediaSourceUrl = source_url => source_url.split('/wp-content/uploads/')[1];

/**
 * Creates the META section from an edpoint
 * @param {Endpoint} endpoint 
 * @param {GitHubTarget} gitHubTarget
 * @returns 
 */
const commonMeta = (endpoint, gitHubTarget) => ({
  api_version: "v2",
  api_url: endpoint.WordPressUrl+apiPath,
  process: {
    source_code: "https://github.com/cagov/wordpress-to-github",
    source_data: endpoint.WordPressUrl,
    deployment_target: `https://github.com/${gitHubTarget.Owner}/${gitHubTarget.Repo}/tree/${gitHubTarget.Branch}`
  },
  refresh_frequency: "as needed"
});

/**
 * Replaces all strings with "rendered" properties with the value of "rendered"
 * @param {{}} json
 */
 const wpRenderRenderFields = json => {
  for(let key of Object.keys(json)) {
    if(json[key] && (json[key]['rendered']==="" || json[key]['rendered'])) {
      json[key] = json[key]['rendered'];
    }
  }
};

/**
 * returns a WordpressApiDateCacheItem for an object type
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} objecttype page/posts/media etc
 * @returns {Promise<WordpressApiDateCacheItem>}
 */
const WpApi_GetCacheItem_ByObjectType = async (wordPressApiUrl,objecttype) => {
    const fetchResponse = await fetchRetry(`${wordPressApiUrl}${objecttype}?per_page=1&orderby=modified&order=desc&_fields=modified&cachebust=${Math.random()}`,{method:"Get",retries:3,retryDelay:2000});

    const result = await fetchResponse.json();
    if(fetchResponse.status===200 && result && result.length) {
      return  ({
        modified:result[0].modified,
        type:objecttype,
        count:Number(fetchResponse.headers.get('X-WP-Total'))
      })
    } else {
      return ({modified:null,type:objecttype,count:0});
    }
};

/**
 * Call the paged wordpress api query, put all the paged data into a single return array
 * @param {string} fetchquery full wordpress query ready to bring back page assets
 */
const WpApi_GetPagedData_ByQuery = async fetchquery => {
  let totalpages = 1; //Will update after the first query

  const rows = [];
  
  for(let currentpage = 1; currentpage<=totalpages; currentpage++) {
    const fetchResponse = await fetchRetry(`${fetchquery}&page=${currentpage}&cachebust=${Math.random()}`,{method:"Get",retries:3,retryDelay:2000});
    totalpages = Number(fetchResponse.headers.get('x-wp-totalpages'));

    rows.push(...await fetchResponse.json());
  }

  return rows;
};

/**
 * Call the paged wordpress api put all the paged data into a single return array
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} objecttype page/posts/media etc
 * @example 
 * await WpApi_GetPagedData_ByObjectType('https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/','posts')
 * //query https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/posts?per_page=100&orderby=slug&order=asc
 */
const WpApi_GetPagedData_ByObjectType = async (wordPressApiUrl,objecttype) => {
  const fetchquery = `${wordPressApiUrl}${objecttype}?per_page=100&orderby=slug&order=asc`;
  console.log(`querying Wordpress API - ${fetchquery}`);

  const rows = await WpApi_GetPagedData_ByQuery(fetchquery);

  //turn all "{rendered:string}"" to just "string"
  rows.forEach(r=>wpRenderRenderFields(r));

  return rows;
};

/**
 * prepares WP content for storage
 * @param {string} html WP html to clean
 */
const cleanupContent = html => html
  .replace(/\n\n\n/g,'\n') //reduce triple spacing
  .replace(/^\n/g,'') //remove leading CR
  ;

/**
 * fetches a dictionary object from WP
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} listname the list to get
 * @returns {Promise<{}>} the dictionary
 */
const fetchDictionary = async (wordPressApiUrl,listname) => Object.assign({}, ...
  (await WpApi_GetPagedData_ByQuery(`${wordPressApiUrl}${listname}?context=embed&hide_empty=true&per_page=100&order_by=name&_fields=id,name`))
    .map((/** @type {{ id: string; name: string; }} */ x)=>({[x.id]:x.name})));

/**
 * @param {Endpoint} endpoint 
 * @param {GitHubTarget} gitHubTarget 
 * @param {string} field_reference //url for field refernce
 * @param {GithubOutputJson} data 
 */
const wrapInFileMeta = (endpoint,gitHubTarget,field_reference,data) => ({
  meta: {
    created_date: data.date_gmt,
    updated_date: data.modified_gmt,
    field_reference,
    ...commonMeta(endpoint,gitHubTarget)
  },
  data
});

/**
 * A custom Github function to check for file exists
 * @param {{ _request: (arg0: string, arg1: any, arg2: any) => Promise<any>; }} myRepo
 * @param {string} path
 * @param {undefined} [data]
 * @param {(arg0: any, arg1: boolean, arg2: any) => void} [cb]
 */
function githubDoesFileExist(myRepo, path, data, cb) {
  return myRepo._request('HEAD', path, data).then(function success(/** @type {any} */ response) {
     if (cb) {
        cb(null, true, response);
     }
     return true;
  }, function failure(/** @type {{ response: { status: number; }; }} */ response) {
     if (response.response.status === 404) {
        if (cb) {
           cb(null, false, response);
        }
        return false;
     }

     if (cb) {
        // @ts-ignore
        cb(response);
     }
     throw response;
  });
}

/**
 * Syncs a binary file with Github, by adding the blob if its not already there and then updating the sha in the tree
 * @param {string} wordpress_url 
 * @param {*} gitRepo 
 * @param {import('../gitTreeCommon').GithubTreeRow[]} mediaTree 
 * @param {Endpoint} endpoint 
 */
const syncBinaryFile = async (wordpress_url, gitRepo, mediaTree, endpoint) => {
  console.log(`Downloading...${wordpress_url}`);
  const fetchResponse = await fetchRetry(wordpress_url,{method:"Get",retries:3,retryDelay:2000});
  const blob = await fetchResponse.arrayBuffer();
  const buffer = Buffer.from(blob);

  let sha = gitHubBlobPredictShaFromBuffer(buffer);

  const exists = await githubDoesFileExist(gitRepo, `/repos/${gitRepo.__fullname}/git/blobs/${sha}`);
  if(!exists) {
    const blobResult = await gitRepo.createBlob(buffer);
    sha = blobResult.data.sha; //should be the same, but just in case
  }

  //swap in the new blob sha here.  If the sha matches something already there it will be determined on server.
  const treeNode = mediaTree.find(x=>x.path===`${endpoint.MediaPath}/${pathFromMediaSourceUrl(wordpress_url)}`);
  delete treeNode.content;
  treeNode.sha = sha;
};

/**
 * deletes properties in the list
 * @param {{}} json
 * @param {string[]} excludeList
 */
const removeExcludedProperties = (json,excludeList) => {
  if(excludeList) {
    excludeList.forEach(x=>{
      delete json[x];
    });
  }
};

/**
 * makes sure value starts with string, prepends if it doesnt'
 * @param {string} value the text to look at
 * @param {string} startText make sure this text appears in front
 */
const ensureStringStartsWith = (startText,value) => (value.startsWith(startText) ? '' : startText) + value;

  /**
   * Places the media section if SyncMedia is on
   * @param {Endpoint} endpoint
   * @param {Map <string>} mediaMap
   * @param {GithubOutputJson} jsonData 
   * @param {string} HTML
   */
   const addMediaSection = (endpoint,mediaMap,jsonData,HTML) => {
    if(endpoint.MediaPath) {
      jsonData.media = [];
      mediaMap.forEach(m=>{
        //Look at media JSON only
        if(m.data && m.data.sizes) {
          m.data.sizes.forEach(s=>{
            const source_url_match = HTML.includes(s.source_url);
            const featured = jsonData.featured_media===m.data.id;
            
            if(featured || source_url_match) {
              jsonData.media.push({
                id:m.data.id,
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
  syncBinaryFile,
  wrapInFileMeta,
  WpApi_GetCacheItem_ByObjectType,
  apiPath,
  fetchDictionary,
  cleanupContent,
  WpApi_GetPagedData_ByObjectType,
  pathFromMediaSourceUrl,
  addMediaSection
};