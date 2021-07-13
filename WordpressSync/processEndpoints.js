// @ts-check
const GitHub = require('github-api');
const commitTitlePosts = 'Wordpress Posts Update';
const commitTitlePages = 'Wordpress Pages Update';
const commitTitleMedia = 'Wordpress Media Update';
const apiPath = '/wp-json/wp/v2/';
const { createTreeFromFileMap, PrIfChanged, gitHubBlobPredictShaFromBuffer } = require('../common/gitTreeCommon');
const fetch = require('node-fetch');
// @ts-ignore
const fetchRetry = require('fetch-retry')(fetch);

/**
* @typedef {Object} Endpoint
* @property {string} WordPressUrl The Wordpress starting point URL
* @property {{Owner: string, Repo: string, Branch: string, SyncMedia:boolean, MediaPath: string, PostPath: string, PagePath: string}} GitHubTarget
*/

/** 
 * @typedef {Object} WordpressMediaSize
 * @property {number} width
 * @property {string} path
 */

/**
* @typedef {Object} WordpressPostRow Expected POST input when using the Wordpress API
* @property {number} author
* @property {number[]} categories
* @property {string} comment_status "closed"
* @property {{rendered:string}} content
* @property {string} date
* @property {string} date_gmt
* @property {{rendered:string}} excerpt
* @property {number} featured_media
* @property {string} format
* @property {{rendered:string}} guid
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
* @property {{rendered:string}} title
* @property {string} type "post"

* @typedef {Object} WordpressPageRow Expected POST input when using the Wordpress API
* @property {number} author
* @property {string} comment_status "closed"
* @property {{rendered:string}} content
* @property {string} date
* @property {string} date_gmt
* @property {{rendered:string}} excerpt
* @property {number} featured_media
* @property {{rendered:string}} guid
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
* @property {{rendered:string}} title
* @property {string} type "page"

* @typedef {Object} WordpressMediaRow Expected POST input when using the Wordpress API
* @property {number} author
* @property {{rendered:string}} caption
* @property {string} comment_status "closed"
* @property {string} date
* @property {string} date_gmt
* @property {{rendered:string}} description
* @property {{rendered:string}} guid
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
* @property {{rendered:string}} title
* @property {string} type "attachment"

* @typedef {Object} GithubOutputJson Expected output when pushing to github Json
* @property {number} id
* @property {string} slug
* @property {string} title
* @property {string} author
* @property {string} date
* @property {string} modified
* @property {string} date_gmt
* @property {string} modified_gmt
* @property {string} wordpress_url
* @property {string} excerpt
* @property {string} format
* @property {string} type
* @property {string[]} [categories]
* @property {string[]} [tags]
* @property {number} [parent]
* @property {number} [menu_order]
* @property {string} path
* @property {number} [featured_media]
* @property {{}[]} [media]
* @property {WordpressMediaSize[]} [sizes]
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
 * @returns 
 */
const commonMeta = endpoint => ({
  api_version: "v2",
  api_url: endpoint.WordPressUrl+apiPath,
  process: {
    source_code: "https://github.com/cagov/cron",
    source_data: endpoint.WordPressUrl,
    deployment_target: `https://github.com/${endpoint.GitHubTarget.Owner}/${endpoint.GitHubTarget.Repo}/tree/${endpoint.GitHubTarget.Branch}`
  },
  refresh_frequency: "as needed"
});

/**
 * Call the paged wordpress api put all the paged data into a single return array
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} objecttype page/posts/media etc
 * @example 
 * await WpApi_GetPagedData('https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/','posts')
 * //query https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/posts?per_page=100&orderby=slug&order=asc
 */
const WpApi_GetPagedData = async (wordPressApiUrl,objecttype) => {
  const fetchquery = `${wordPressApiUrl}${objecttype}?per_page=100&orderby=slug&order=asc`;
  console.log(`querying Wordpress API - ${fetchquery}`);

  let totalpages = 1; //Will update after the first query

  const rows = [];
  
  for(let currentpage = 1; currentpage<=totalpages; currentpage++) {
    const fetchResponse = await fetchRetry(`${fetchquery}&page=${currentpage}`,{method:"Get",retries:3,retryDelay:2000});
    totalpages = Number(fetchResponse.headers.get('x-wp-totalpages'));

    rows.push(...await fetchResponse.json());
  }

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
  (await fetchRetry(`${wordPressApiUrl}${listname}?context=embed&hide_empty=true&per_page=100`,
    {method:"Get",retries:3,retryDelay:2000})
    .then(res => res.json()))
    .map(x=>({[x.id]:x.name})));

/**
 * Gets a JSON starting point common to many WP items
 * @param {WordpressPostRow | WordpressMediaRow | WordpressPageRow} wpRow row from API
 * @param {{}} userlist dictionary of users
 * @returns {GithubOutputJson}
 */
const getWpCommonJsonData = (wpRow,userlist) => 
  // @ts-ignore
  getNonBlankValues(
    {...wpRow,
      title: wpRow.title.rendered,
      author: userlist[wpRow.author],
      wordpress_url: wpRow['source_url'] || wpRow.link,
      excerpt: wpRow['excerpt'] ? wpRow['excerpt'].rendered : null
    },
    [
      'id',
      'slug',
      'title',
      'author',
      'date',
      'modified',
      'date_gmt',
      'modified_gmt',
      'meta',
      'template',
      'media_type',
      'mime_type',
      'wordpress_url',
      'excerpt',
      'format',
      'type',
      'design_system_fields', // is object
      'og_meta', // is object
      'site_settings' // is object
    ]);

/**
 * returns an object filled with the non null keys of another object
 * @param {*} fromObject the object to get things out of
 * @param {string[]} keys what to pull in from the other object
 */
const getNonBlankValues = (fromObject,keys) => {
  let result = {};
  keys.filter(k=>fromObject[k] && (!Array.isArray(fromObject[k]) || fromObject[k].length)).forEach(k=> {
      result[k] = fromObject[k];
  });
  return result;
};

/**
 * @param {Endpoint} endpoint 
 * @param {GithubOutputJson} data 
 */
const wrapInFileMeta = (endpoint,data) => ({
  meta: {
    created_date: data.date_gmt,
    updated_date: data.modified_gmt,
    ...commonMeta(endpoint)
  },
  data
});

/**
 * callback function got GitHub API that ignores 404 errors.
 * @param {*} [Error]
 * @example
 * const exists = await gitRepo._request('HEAD', `/repos/${gitRepo.__fullname}/git/blobs/${sha}`,null, ok404);
 * @returns
 */
const ok404 = Error => {
  if(Error) {
    if(Error.response.status!==404) throw Error;
  }
};

/**
 * Syncs a binary file with Github, by adding the blob if its not already there and then updating the sha in the tree
 * @param {string} source_url 
 * @param {*} gitRepo 
 * @param {import('../common/gitTreeCommon').GithubTreeRow[]} mediaTree 
 * @param {Endpoint} endpoint 
 */
const syncBinaryFile = async (source_url, gitRepo, mediaTree, endpoint) => {
  console.log(`Downloading...${source_url}`);
  const fetchResponse = await fetchRetry(source_url,{method:"Get",retries:3,retryDelay:2000});
  const blob = await fetchResponse.arrayBuffer();
  const buffer = Buffer.from(blob);

  let sha = gitHubBlobPredictShaFromBuffer(buffer);

  const exists = await gitRepo._request('HEAD', `/repos/${gitRepo.__fullname}/git/blobs/${sha}`,null, ok404);
  if(!exists) {
    const blobResult = await gitRepo.createBlob(buffer);
    sha = blobResult.data.sha; //should be the same, but just in case
  }

  //swap in the new blob sha here.  If the sha matches something already there it will be determined on server.
  const treeNode = mediaTree.find(x=>x.path===`${endpoint.GitHubTarget.MediaPath}/${pathFromMediaSourceUrl(source_url)}`);
  delete treeNode.content;
  treeNode.sha = sha;
};

/**
 * process a Wordpress endpoint and place the data in GitHub
 * @param {Endpoint} endpoint 
 * @param {{token:string}} gitHubCredentials 
 * @param {{name:string,email:string}} gitHubCommitter 
 */
const SyncEndpoint = async (endpoint, gitHubCredentials, gitHubCommitter) => {
  const gitModule = new GitHub(gitHubCredentials);
  const wordPressApiUrl = endpoint.WordPressUrl+apiPath;
  // @ts-ignore
  const gitRepo = await gitModule.getRepo(endpoint.GitHubTarget.Owner,endpoint.GitHubTarget.Repo);

  //List of WP categories
  const categorylist = await fetchDictionary(wordPressApiUrl,'categories');
  const taglist = await fetchDictionary(wordPressApiUrl,'tags');
  const userlist = await fetchDictionary(wordPressApiUrl,'users');
  /** @type {Map <string>} */
  const postMap = new Map();
  /** @type {Map <string>} */
  const pagesMap = new Map();
  /** @type {Map <string>} */
  const mediaMap = endpoint.GitHubTarget.SyncMedia ? new Map() : null;

  // MEDIA
  const mediaContentPlaceholder = 'TBD : Binary file to be updated in a later step';
  if(endpoint.GitHubTarget.SyncMedia) {
    /** @type {WordpressMediaRow[]} */
    const allMedia = await WpApi_GetPagedData(wordPressApiUrl,'media');

    allMedia.forEach(x=>{
      const jsonData = getWpCommonJsonData(x,userlist);

      if(x.media_details.sizes) {
        jsonData.sizes = Object.keys(x.media_details.sizes).map(s=>({
          type:s,
          path:pathFromMediaSourceUrl(x.media_details.sizes[s].source_url),
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

      mediaMap.set(`${pathFromMediaSourceUrl(x.source_url).split('.')[0]}.json`,wrapInFileMeta(endpoint,jsonData));
    });

    let mediaTree = await createTreeFromFileMap(gitRepo,endpoint.GitHubTarget.Branch,mediaMap,endpoint.GitHubTarget.MediaPath);
 
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
            //sometimes the source_url is full and sometimes it is relative
            const imageUrl = (sizeJson.source_url.startsWith('http') ? '' : endpoint.WordPressUrl) + sizeJson.source_url;
            await syncBinaryFile(imageUrl, gitRepo, mediaTree, endpoint);
          }
        } else {
          //not sized media (PDF or non-image)
          await syncBinaryFile(mediaTreeItem.wordpress_url,gitRepo, mediaTree, endpoint);
        }
      }
    }

    //Remove any leftover binary placeholders...
    mediaTree = mediaTree.filter(x=>x.content !== mediaContentPlaceholder);
    
    await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, mediaTree, `${commitTitleMedia} (${mediaTree.length} updates)`, gitHubCommitter, true);
  }
  
  /**
   * Places the media section if SyncMedia is on
   * @param {GithubOutputJson} jsonData 
   * @param {WordpressPostRow | WordpressPageRow | WordpressMediaRow} WpRow 
   * @param {string} HTML 
   */
  const addMediaSection = (jsonData,WpRow,HTML) => {
    if(endpoint.GitHubTarget.SyncMedia) {
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
  const allPosts = await WpApi_GetPagedData(wordPressApiUrl,'posts');
  allPosts.forEach(x=>{
    const jsonData = getWpCommonJsonData(x,userlist);
    jsonData.categories = x.categories.map(t=>categorylist[t]);
    jsonData.tags = x.tags.map(t=>taglist[t]);

    const HTML = cleanupContent(x.content.rendered);
  
    addMediaSection(jsonData,x,HTML);

    postMap.set(`${x.slug}.json`,wrapInFileMeta(endpoint,jsonData));
    postMap.set(`${x.slug}.html`,HTML);
  });

  const postTree = await createTreeFromFileMap(gitRepo,endpoint.GitHubTarget.Branch,postMap,endpoint.GitHubTarget.PostPath);
  await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, postTree, `${commitTitlePosts} (${postTree.filter(x=>x.path.endsWith(".html")).length} updates)`, gitHubCommitter, true);


  // PAGES
  /** @type {WordpressPageRow[]} */
  const allPages = await WpApi_GetPagedData(wordPressApiUrl,'pages');
  allPages.forEach(x=>{
    const jsonData = getWpCommonJsonData(x,userlist);
    jsonData.parent = x.parent;
    jsonData.menu_order = x.menu_order;

    const HTML = cleanupContent(x.content.rendered);

    addMediaSection(jsonData,x,HTML);

    pagesMap.set(`${x.slug}.json`,wrapInFileMeta(endpoint,jsonData));
    pagesMap.set(`${x.slug}.html`,HTML);
  });

  const pagesTree = await createTreeFromFileMap(gitRepo,endpoint.GitHubTarget.Branch,pagesMap,endpoint.GitHubTarget.PagePath);
  await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, pagesTree, `${commitTitlePages} (${pagesTree.filter(x=>x.path.endsWith(".html")).length} updates)`, gitHubCommitter, true);
};

module.exports = {
  SyncEndpoint
};