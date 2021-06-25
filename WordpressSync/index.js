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
      wordpress_url: wpRow.link,
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
      'wordpress_url',
      'file_path_html',
      'file_path_json',
      'excerpt'
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

module.exports = async () => {
  const gitModule = new GitHub({ token: process.env["GITHUB_TOKEN"] });

  for(const endpoint of endpoints.projects.filter(x=>x.enabled)) {
    console.log(`*** Checking endpoint for ${endpoint.name} ***`);
    const wordPressApiUrl = endpoint.WordPressUrl+apiPath;
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
      const mediaSplitUrl = '/wp-content/uploads/';

      allMedia.forEach(x=>{
        const jsonData = getWpCommonJsonData(x,userlist);
        delete jsonData.excerpt;
  
        jsonData.sizes = Object.keys(x.media_details.sizes).map(s=>({
          type:s,
          path:x.media_details.sizes[s].source_url.split(mediaSplitUrl)[1],
          ...x.media_details.sizes[s]}));
        // {...x.media_details.sizes};

        jsonData.sizes.sort((a,b)=>b.width-a.width); //Big first

        mediaMap.set(x.media_details.file.replace('.png','.json'),wrapInFileMeta(endpoint,jsonData));
        //TODO: make replace use other image types, consider PDF
        //put binary placeholders so they aren't deleted.  Will search for these if an update happens.
        for (const s of jsonData.sizes) {
          mediaMap.set(s.path, mediaContentPlaceholder);
        }
      });

      let mediaTree = await createTreeFromFileMap(gitRepo,endpoint.GitHubTarget.Branch,mediaMap,endpoint.GitHubTarget.MediaPath);
   
      //Pull in binaries for any media meta changes
      for (const mediaTreeSizes of mediaTree
        .filter(x=>x.content && x.content!==mediaContentPlaceholder)
        .map(mt=>JSON.parse(mt.content).data.sizes)) {
        for (const sizeJson of mediaTreeSizes) {
          console.log(`Downloading...${sizeJson.source_url}`);
          const fetchResponse = await fetchRetry(sizeJson.source_url,{method:"Get",retries:3,retryDelay:2000});
          const blob = await fetchResponse.arrayBuffer();
          const buffer = Buffer.from(blob);

          let sha = gitHubBlobPredictShaFromBuffer(buffer);
          const ok404 = (Error,Data) => {
            if(Error) {
              if(Error.response.status!==404) throw Error;
            }
            return Data;
          };
          const exists = await gitRepo._request('HEAD', `/repos/${gitRepo.__fullname}/git/blobs/${sha}`,null, ok404);
          if(!exists) {
            console.log('adding new file');
            const blobResult = await gitRepo.createBlob(buffer);
            sha = blobResult.data.sha; //should be the same, but just in case
          }

          //swap in the new blob sha here.  If the sha matches something already there it will be determined on server.
          const treeNode = mediaTree.find(x=>x.path===`${endpoint.GitHubTarget.MediaPath}/${sizeJson.path}`);
          delete treeNode.content;
          treeNode.sha = sha ;
        }
      }
      //Remove any leftover binary placeholders...
      mediaTree = mediaTree.filter(x=>x.content !== mediaContentPlaceholder);
      
      await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, mediaTree, `${commitTitleMedia} (${mediaTree.length} updates)`, committer, true);
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
      jsonData.categories = x.categories.map(t=>categorylist[t]);
      jsonData.tags = x.tags.map(t=>taglist[t]);

      const HTML = cleanupContent(x.content.rendered);
    
      addMediaSection(jsonData,x,HTML);

      postMap.set(`${x.slug}.json`,wrapInFileMeta(endpoint,jsonData));
      postMap.set(`${x.slug}.html`,HTML);
    });

    const postTree = await createTreeFromFileMap(gitRepo,endpoint.GitHubTarget.Branch,postMap,endpoint.GitHubTarget.PostPath);
    await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, postTree, `${commitTitlePosts} (${postTree.filter(x=>x.path.endsWith(".html")).length} updates)`, committer, true);


    // PAGES
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
    await PrIfChanged(gitRepo, endpoint.GitHubTarget.Branch, pagesTree, `${commitTitlePages} (${pagesTree.filter(x=>x.path.endsWith(".html")).length} updates)`, committer, true);
  }
};