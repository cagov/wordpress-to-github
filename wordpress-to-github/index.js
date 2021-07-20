// @ts-check
const GitHub = require('github-api');
const commitTitlePosts = 'Wordpress Posts Update';
const commitTitlePages = 'Wordpress Pages Update';
const commitTitleMedia = 'Wordpress Media Update';
const fieldMetaReference = {
  posts: "https://developer.wordpress.org/rest-api/reference/posts/",
  pages: "https://developer.wordpress.org/rest-api/reference/pages/",
  media: "https://developer.wordpress.org/rest-api/reference/pages/"
};
  /** @type {Map <string,WordpressApiDateCache>} */
const updateCache = new Map();
const apiPath = '/wp-json/wp/v2/';
const { createTreeFromFileMap, PrIfChanged, gitHubBlobPredictShaFromBuffer } = require('../common/gitTreeCommon');
const fetch = require('node-fetch');
// @ts-ignore
const fetchRetry = require('fetch-retry')(fetch);

/**
* @typedef {Object} Endpoint
* @property {boolean} [disabled] true to ignore processing
* @property {string} WordPressUrl The Wordpress starting point URL
* @property {string[]} [ExcludeProperties] list of properties to exclude
* @property {boolean} [SyncMedia]
* @property {string} PostPath
* @property {string} PagePath
* @property {string} [MediaPath]
*
* @typedef {{Owner:string, Repo:string, Branch:string, ConfigPath:string}} GitHubTarget
* @typedef {{name:string, email:string}} GitHubCommitter
* @typedef {{token:string}} GitHubCredentials
*
* @typedef {{width:number,path:string}} WordpressMediaSize
*
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

* @typedef {Object} WordpressApiDateCache List of most recent modifications for Wordpress objects
* @property {string} media_modified
* @property {string} posts_modified
* @property {string} pages_modified
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
 * 
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} objecttype page/posts/media etc
 * @example 
 * await WpApi_GetPagedData_ByObjectType('https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/','posts')
 * //query https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/posts?per_page=100&orderby=slug&order=asc
 */
const WpApi_GetRecentUpdateDate_ByObjectType = async (wordPressApiUrl,objecttype) => {
    const fetchResponse = await fetchRetry(`${wordPressApiUrl}${objecttype}?per_page=1&orderby=modified&order=desc&_fields=modified&cachebust=${Math.random()}`,{method:"Get",retries:3,retryDelay:2000});

    const result = await fetchResponse.json();
    if(result && result.length) {
      return result[0].modified;
    }
};

/**
 * 
 * @param {string} wordPressApiUrl WP source URL
 */
const WpApi_GetUpdateCacheData = async (wordPressApiUrl) => 
/** @type {WordpressApiDateCache} */
  ( {
    media_modified: (await WpApi_GetRecentUpdateDate_ByObjectType(wordPressApiUrl,'media')),
    posts_modified: (await WpApi_GetRecentUpdateDate_ByObjectType(wordPressApiUrl,'posts')),
    pages_modified: (await WpApi_GetRecentUpdateDate_ByObjectType(wordPressApiUrl,'pages'))
  });

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
 * @param {import('../common/gitTreeCommon').GithubTreeRow[]} mediaTree 
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
 * process a Wordpress endpoint and place the data in GitHub
 * @param {GitHubTarget} gitHubTarget
 * @param {GitHubCredentials} gitHubCredentials
 * @param {GitHubCommitter} gitHubCommitter
 */
const SyncEndpoint = async (gitHubTarget, gitHubCredentials, gitHubCommitter) => {
  const gitModule = new GitHub(gitHubCredentials);

  // @ts-ignore
  const gitRepo = await gitModule.getRepo(gitHubTarget.Owner,gitHubTarget.Repo);

  /** @type {Endpoint} */
  const endpoint = (await gitRepo.getContents(gitHubTarget.Branch,gitHubTarget.ConfigPath,true)).data.data['wordpress-to-github-config'];

  if(endpoint.disabled) {
    console.log('Remote config is disabled.');
    return;
  }

  const wordPressApiUrl = endpoint.WordPressUrl+apiPath;

  const updateCacheItem = updateCache.get(wordPressApiUrl);

  if(updateCacheItem && JSON.stringify(await WpApi_GetUpdateCacheData(wordPressApiUrl))===JSON.stringify(updateCacheItem)) {
    console.log('match cache for '+wordPressApiUrl);
    return;
  }

  //List of WP categories
  const categorylist = await fetchDictionary(wordPressApiUrl,'categories');
  const taglist = await fetchDictionary(wordPressApiUrl,'tags');
  const userlist = await fetchDictionary(wordPressApiUrl,'users');
  /** @type {Map <string>} */
  const postMap = new Map();
  /** @type {Map <string>} */
  const pagesMap = new Map();
  /** @type {Map <string>} */
  const mediaMap = endpoint.SyncMedia ? new Map() : null;

  // MEDIA
  const mediaContentPlaceholder = 'TBD : Binary file to be updated in a later step';
  if(endpoint.SyncMedia) {
    /** @type {WordpressMediaRow[]} */
    const allMedia = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl,'media');

    allMedia.forEach(x=>{
      /** @type {GithubOutputJson} */
      const jsonData = {...x,
        author: userlist[x.author],
        wordpress_url:ensureStringStartsWith(endpoint.WordPressUrl,x.source_url)
      };

      removeExcludedProperties(jsonData,endpoint.ExcludeProperties);

      if(x.media_details.sizes && Object.keys(x.media_details.sizes).length) {
        jsonData.sizes = Object.keys(x.media_details.sizes).map(s=>({
          type:s,
          path:pathFromMediaSourceUrl(x.media_details.sizes[s].source_url),
          wordpress_url:ensureStringStartsWith(endpoint.WordPressUrl,x.media_details.sizes[s].source_url),
          ...x.media_details.sizes[s]}));

        jsonData.sizes.sort((a,b)=>b.width-a.width); //Big first

        //put binary placeholders so they aren't deleted.  Will search for these if an update happens.
        for (const s of jsonData.sizes) {
          mediaMap.set(s.path, mediaContentPlaceholder);
        }
      } else {
        //PDF
        jsonData.path = pathFromMediaSourceUrl(x.source_url);
        mediaMap.set(jsonData.path, mediaContentPlaceholder);
      }

      mediaMap.set(`${pathFromMediaSourceUrl(x.source_url).split('.')[0]}.json`,wrapInFileMeta(endpoint,gitHubTarget,fieldMetaReference.media,jsonData));
    });

    let mediaTree = await createTreeFromFileMap(gitRepo,gitHubTarget.Branch,mediaMap,endpoint.MediaPath);
 
    const mediaChanges = mediaTree
      .filter(x=>x.content && x.content!==mediaContentPlaceholder)
      .map(mt=>JSON.parse(mt.content).data);

    if(mediaChanges.length) {
      console.log(`Checking ${mediaTree.length} media items`);

      //Pull in binaries for any media meta changes
      for (const mediaTreeItem of mediaChanges) {
        if (mediaTreeItem.sizes) {
          //Sized images
          for (const sizeJson of mediaTreeItem.sizes) {
            await syncBinaryFile(sizeJson.wordpress_url, gitRepo, mediaTree, endpoint);
          }
        } else {
          //not sized media (PDF or non-image)
          await syncBinaryFile(mediaTreeItem.wordpress_url, gitRepo, mediaTree, endpoint);
        }
      }
    }

    //Remove any leftover binary placeholders...
    mediaTree = mediaTree.filter(x=>x.content !== mediaContentPlaceholder);
    
    await PrIfChanged(gitRepo, gitHubTarget.Branch, mediaTree, `${commitTitleMedia} (${mediaTree.length} updates)`, gitHubCommitter, true);
    
  }
  
  /**
   * Places the media section if SyncMedia is on
   * @param {GithubOutputJson} jsonData 
   * @param {WordpressPostRow | WordpressPageRow | WordpressMediaRow} WpRow 
   * @param {string} HTML 
   */
  const addMediaSection = (jsonData,WpRow,HTML) => {
    if(endpoint.SyncMedia) {
      if(WpRow['featured_media']) {
        jsonData.featured_media = WpRow['featured_media'];
      }

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
  
  // POSTS
  /** @type {WordpressPostRow[]} */
  const allPosts = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl,'posts');
  allPosts.forEach(x=>{
    /** @type {GithubOutputJson} */
    const jsonData = {...x,
      author: userlist[x.author],
      wordpress_url: x.link,
      categories: x.categories.map(t=>categorylist[t]),
      tags: x.tags.map(t=>taglist[t]),
    };

    const HTML = cleanupContent(x.content);
  
    addMediaSection(jsonData,x,HTML);

    removeExcludedProperties(jsonData,endpoint.ExcludeProperties);

    postMap.set(`${x.slug}.json`,wrapInFileMeta(endpoint,gitHubTarget,fieldMetaReference.posts,jsonData));
    postMap.set(`${x.slug}.html`,HTML);
  });

  const postTree = await createTreeFromFileMap(gitRepo,gitHubTarget.Branch,postMap,endpoint.PostPath);
  await PrIfChanged(gitRepo, gitHubTarget.Branch, postTree, `${commitTitlePosts} (${postTree.filter(x=>x.path.endsWith(".html")).length} updates)`, gitHubCommitter, true);

  // PAGES
  /** @type {WordpressPageRow[]} */
  const allPages = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl,'pages');
  allPages.forEach(x=>{
    /** @type {GithubOutputJson} */
    const jsonData = {...x,
      author: userlist[x.author],
      wordpress_url: x.link
    };

    const HTML = cleanupContent(x.content);

    addMediaSection(jsonData,x,HTML);

    removeExcludedProperties(jsonData,endpoint.ExcludeProperties);

    pagesMap.set(`${x.slug}.json`,wrapInFileMeta(endpoint,gitHubTarget,fieldMetaReference.media,jsonData));
    pagesMap.set(`${x.slug}.html`,HTML);
  });

  const pagesTree = await createTreeFromFileMap(gitRepo,gitHubTarget.Branch,pagesMap,endpoint.PagePath);
  await PrIfChanged(gitRepo, gitHubTarget.Branch, pagesTree, `${commitTitlePages} (${pagesTree.filter(x=>x.path.endsWith(".html")).length} updates)`, gitHubCommitter, true);

  updateCache.set(wordPressApiUrl,await WpApi_GetUpdateCacheData(wordPressApiUrl));
};

module.exports = {
  SyncEndpoint
};