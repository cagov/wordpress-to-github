const GitHub = require('github-api');
const endpoints = require('./endpoints.json').data;
const committer = {
  name: process.env["GITHUB_NAME"],
  email: process.env["GITHUB_EMAIL"]
};
const commitTitlePosts = 'Wordpress Posts Update';
const commitTitlePages = 'Wordpress Pages Update';
const commitTitleMedia = 'Wordpress Media Update';
const apiPath = '/wp-json/wp/v2/';
const { createTreeFromFileMap, PrIfChanged, gitHubBlobPredictShaFromBuffer } = require('../common/gitTreeCommon');
const fetch = require('node-fetch');
const fetchRetry = require('fetch-retry')(fetch);

/**
 * Get the path from the a media source url
 * @param {string} source_url 
 */
const pathFromMediaSourceUrl = source_url => source_url.split('/wp-content/uploads/')[1];

/**
 * @param {{WordPressUrl: string, GitHubTarget: {Owner: string, Repo: string, Branch: string}}} endpoint 
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
 * Call the paged wordpress api
 * @param {string} wordPressApiUrl WP source URL
 * @param {string} objecttype page/posts/media etc
 * @returns {Promise<{
 *    id:number,
 *    date_gmt:string
 * }[]]>}
 */
const WpApi_GetPagedData = async (wordPressApiUrl,objecttype) => {
  const fetchquery = `${wordPressApiUrl}${objecttype}?per_page=100&orderby=slug&order=asc`;
  console.log(`querying Wordpress API - ${fetchquery}`);

  let totalpages = 999;

  const rows = [];
  
  for(let currentpage = 1; currentpage<=totalpages; currentpage++) {
    const fetchResponse = await fetchRetry(`${fetchquery}&page=${currentpage}`,{method:"Get",retries:3,retryDelay:2000});
    totalpages = Number(fetchResponse.headers.get('x-wp-totalpages'));
    const fetchResponseJson = await fetchResponse.json();

    fetchResponseJson.forEach(x=>rows.push(x));
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
 * @param {{}} wpRow row from API
 * @param {{}} userlist dictionary of users
 * @param {string} file_path_html
 * @param {string} file_path_json 
 */
const getWpCommonJsonData = (wpRow,userlist) => 
  getNonBlankValues(
    {...wpRow,
      title: wpRow.title.rendered,
      author: userlist[wpRow.author],
      wordpress_url: wpRow.source_url || wpRow.link,
      excerpt: wpRow.excerpt ? wpRow.excerpt.rendered : null
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
      'design_system_fields',
      'og_meta',
      'site_settings',
      'content',
    ]);
/**
 * returns an object filled with the non null keys of another object
 * @param {{}} fromObject the object to get things out of
 * @param {[string]} keys what to pull in from the other object
 */
const getNonBlankValues = (fromObject,keys) => {
  let result = {};
  keys.filter(k=>fromObject[k] && (!Array.isArray(fromObject[k]) || fromObject[k].length)).forEach(k=> {
      result[k] = fromObject[k];
  });
  return result;
};

/**
 * @param {{WordPressUrl: string, GitHubTarget: {Owner: string, Repo: string, Path: string,Branch: string}}} endpoint 
 * @param {{ date_gmt: string, modified_gmt: string }} data 
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
 * @param {*} [Data] 
 * @param {*} [Response]
 * @example
 * const exists = await gitRepo._request('HEAD', `/repos/${gitRepo.__fullname}/git/blobs/${sha}`,null, ok404);
 * @returns
 */
const ok404 = (Error,Data,Response) => {
  if(Error) {
    if(Error.response.status!==404) throw Error;
  }
};

/**
 * Syncs a binary file with Github, by adding the blob if its not already there and then updating the sha in the tree
 * @param {string} source_url 
 * @param {{}} treeNode 
 */
const syncBinaryFile = async (source_url, gitRepo, mediaTree, endpoint) => {
  console.log(`Downloading...${source_url}`);
  const fetchResponse = await fetchRetry(source_url,{method:"Get",retries:3,retryDelay:2000});
  const blob = await fetchResponse.arrayBuffer();
  const buffer = Buffer.from(blob);

  let sha = gitHubBlobPredictShaFromBuffer(buffer); //sha = '38ec6101bdd299856ad13a05a61013872c3e70a8';

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

module.exports = async () => {
  const gitModule = new GitHub({ token: process.env["GITHUB_TOKEN"] });

  for(const endpoint of endpoints.projects.filter(x=>x.enabled)) {
    console.log(`*** Checking endpoint for ${endpoint.name} ***`);
    const wordPressApiUrl = endpoint.WordPressUrl+apiPath;
    const hostUrl = endpoint.HostUrl;
    const gitRepo = await gitModule.getRepo(endpoint.GitHubTarget.Owner,endpoint.GitHubTarget.Repo);
    //const gitIssues = await gitModule.getIssues(githubUser,githubRepo);

    //List of WP categories
    const categorylist = await fetchDictionary(wordPressApiUrl,'categories');
    const taglist = await fetchDictionary(wordPressApiUrl,'tags');
    const userlist = await fetchDictionary(wordPressApiUrl,'users');

    const postMap = new Map();
    const pagesMap = new Map();
    const mediaMap = endpoint.GitHubTarget.SyncMedia ? new Map() : null;
    
    // MEDIA
    const mediaContentPlaceholder = 'TBD : Binary file to be updated in a later step'; 

    if(endpoint.GitHubTarget.SyncMedia) {
      const allMedia = await WpApi_GetPagedData(wordPressApiUrl,'media');
      allMedia.forEach(x=>{
        const jsonData = getWpCommonJsonData(x,userlist);
        delete jsonData.excerpt;
  
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
   
      //Pull in binaries for any media meta changes
      for (const mediaTreeItem of mediaTree
        .filter(x=>x.content && x.content!==mediaContentPlaceholder)
        .map(mt=>JSON.parse(mt.content).data)) {

        if (mediaTreeItem.sizes) {
          //Sized images
          for (const sizeJson of mediaTreeItem.sizes) {
            await syncBinaryFile(sizeJson.source_url,gitRepo, mediaTree, endpoint);
          }
        } else {
          //not sized media (PDF or non-image)
          await syncBinaryFile(mediaTreeItem.wordpress_url,gitRepo, mediaTree, endpoint);
        }

      }
      //Remove any leftover binary placeholders...
      mediaTree = mediaTree.filter(x=>x.content !== mediaContentPlaceholder);
      
      await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, mediaTree, `${commitTitleMedia} (${mediaTree.length} updates)`, committer, true);
    }

    /**
     * Point specific WP content to static file hosting
     * @param {*} jsonData 
     * @param {*} WpRow 
     * @param {*} HTML 
     */
    const convertWpEndpointsToStatic = (jsonData,WpRow,HTML,type) => {
      let apiSearchString = wordPressApiUrl;
      if (apiSearchString.charAt(apiSearchString.length - 1) === "/") {
        apiSearchString = apiSearchString.substring(0, apiSearchString.length - 1);
      }
      let output = HTML;
      let apiString = new RegExp('\\' + apiSearchString, 'g');
      output  = output.replace(apiString, hostUrl.Production + type);
      return output;
    }

    /**
     * Point specific WP media files to static file hosting
     * @param {*} jsonData 
     * @param {*} WpRow 
     * @param {*} HTML 
     */
    const staticWpUploads = (jsonData,WpRow,HTML) => {
      let apiSearchString = endpoint.WordPressUrl + "/wp-content/uploads/";
      
      if (apiSearchString.charAt(apiSearchString.length - 1) === "/") {
        apiSearchString = apiSearchString.substring(0, apiSearchString.length - 1);
      }
      let output = HTML;
      let apiString = new RegExp('\\' + apiSearchString, 'g');
      output  = output.replace(apiString, hostUrl.Production + "media");
      return output;
    }

    /**
     * Places the media section if SyncMedia is on
     * @param {{}} jsonData 
     * @param {{}} WpRow 
     * @param {string} HTML 
     */
    const addMediaSection = (jsonData,WpRow,HTML) => {
      if(endpoint.GitHubTarget.SyncMedia) {

        if(WpRow.featured_media) {
          jsonData.featured_media = WpRow.featured_media;
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
    const allPosts = await WpApi_GetPagedData(wordPressApiUrl,'posts');
    allPosts.forEach(x=>{
      const jsonData = getWpCommonJsonData(x,userlist);
      jsonData.headless = true;
      jsonData.categories = x.categories.map(t=>categorylist[t]);
      jsonData.tags = x.tags.map(t=>taglist[t]);

      // HTML markup character cleanup
      var HTML = cleanupContent(x.content.rendered);
      // Get field based media items
      addMediaSection(jsonData,x,HTML);
      // Convert hosted WP content endpoints to static versions
      if(endpoint.GitHubTarget.RelativePaths) {
      HTML = convertWpEndpointsToStatic(jsonData,x,HTML,"posts");
      }
      // Convert WP upload paths to use path to media library
      if(endpoint.GitHubTarget.SyncMedia && endpoint.GitHubTarget.RelativePaths) {
        HTML = staticWpUploads(jsonData,x,HTML);
      }

      // og_meta is set in custom rest field, using data from autodescription plugin.
      // Clean it up so that media links and endpoints point to the static site.
      if (jsonData.og_meta !== undefined && jsonData.og_meta.og_rendered !== undefined) {
        var OG_META = cleanupContent(x.og_meta.og_rendered);
        addMediaSection(jsonData,x,OG_META);
        if(endpoint.GitHubTarget.RelativePaths) {
          OG_META = convertWpEndpointsToStatic(jsonData,x,OG_META);
        }
        if(endpoint.GitHubTarget.SyncMedia && endpoint.GitHubTarget.RelativePaths) {
          OG_META = staticWpUploads(jsonData,x,OG_META);
        }
        // Fix cleaned up og_meta tag with static links.
        jsonData.og_meta.og_rendered = OG_META;
      }

      postMap.set(`${x.slug}.json`,wrapInFileMeta(endpoint,jsonData));
      postMap.set(`${x.slug}.html`,HTML);
    });

    const postTree = await createTreeFromFileMap(gitRepo,endpoint.GitHubTarget.Branch,postMap,endpoint.GitHubTarget.PostPath);
    await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, postTree, `${commitTitlePosts} (${postTree.filter(x=>x.path.endsWith(".html")).length} updates)`, committer, true);


    // PAGES
    const allPages = await WpApi_GetPagedData(wordPressApiUrl,'pages');
    allPages.forEach(x=>{
      const jsonData = getWpCommonJsonData(x,userlist);
      jsonData.headless = true;
      jsonData.parent = x.parent;
      jsonData.menu_order = x.menu_order;

      // HTML markup character cleanup
      var HTML = cleanupContent(x.content.rendered);
      // Get field based media items
      addMediaSection(jsonData,x,HTML);
      // Convert hosted WP content endpoints to static versions
      if(endpoint.GitHubTarget.RelativePaths) {
      HTML = convertWpEndpointsToStatic(jsonData,x,HTML,"posts");
      }
      // Convert WP upload paths to use path to media library
      if(endpoint.GitHubTarget.SyncMedia && endpoint.GitHubTarget.RelativePaths) {
        HTML = staticWpUploads(jsonData,x,HTML);
      }

      // og_meta is set in custom rest field, using data from autodescription plugin.
      // Clean it up so that media links and endpoints point to the static site.
      if (jsonData.og_meta !== undefined && jsonData.og_meta.og_rendered !== undefined) {
        var OG_META = cleanupContent(x.og_meta.og_rendered);
        addMediaSection(jsonData,x,OG_META);
        if(endpoint.GitHubTarget.RelativePaths) {
          OG_META = convertWpEndpointsToStatic(jsonData,x,OG_META);
        }
        if(endpoint.GitHubTarget.SyncMedia && endpoint.GitHubTarget.RelativePaths) {
          OG_META = staticWpUploads(jsonData,x,OG_META);
        }
        // Fix cleaned up og_meta tag with static links.
        jsonData.og_meta.og_rendered = OG_META;
      }

      pagesMap.set(`${x.slug}.json`,wrapInFileMeta(endpoint,jsonData));
      pagesMap.set(`${x.slug}.html`,HTML);
    });

    const pagesTree = await createTreeFromFileMap(gitRepo,endpoint.GitHubTarget.Branch,pagesMap,endpoint.GitHubTarget.PagePath);
    await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, pagesTree, `${commitTitlePages} (${pagesTree.filter(x=>x.path.endsWith(".html")).length} updates)`, committer, true);
  }
};