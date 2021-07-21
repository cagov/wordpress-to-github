// @ts-check
const GitHub = require('github-api');
const { createTreeFromFileMap, PrIfChanged } = require('./gitTreeCommon');
const {   
  ensureStringStartsWith,
  removeExcludedProperties,
  syncBinaryFile,
  wrapInFileMeta,
  WpApi_GetCacheItem_ByObjectType,
  apiPath,
  fetchDictionary,
  cleanupContent,
  WpApi_GetPagedData_ByObjectType,
  pathFromMediaSourceUrl
} = require('./common');
const commitTitlePosts = 'Wordpress Posts Update';
const commitTitlePages = 'Wordpress Pages Update';
const commitTitleMedia = 'Wordpress Media Update';
const fieldMetaReference = {
  posts: "https://developer.wordpress.org/rest-api/reference/posts/",
  pages: "https://developer.wordpress.org/rest-api/reference/pages/",
  media: "https://developer.wordpress.org/rest-api/reference/pages/"
};
  /** @type {Map <string,import('./common').WordpressApiDateCacheItem>} */
const updateCache = new Map();
const cacheObjects = ['media','posts','pages'];

/**
 * process a Wordpress endpoint and place the data in GitHub
 * @param {import('./common').GitHubTarget} gitHubTarget
 * @param {import('./common').GitHubCredentials} gitHubCredentials
 * @param {import('./common').GitHubCommitter} gitHubCommitter
 */
const SyncEndpoint = async (gitHubTarget, gitHubCredentials, gitHubCommitter) => {
  const gitModule = new GitHub(gitHubCredentials);

  // @ts-ignore
  const gitRepo = await gitModule.getRepo(gitHubTarget.Owner,gitHubTarget.Repo);

  /** @type {import('./common').Endpoint} */
  const endpoint = (await gitRepo.getContents(gitHubTarget.Branch,gitHubTarget.ConfigPath,true)).data.data['wordpress-to-github-config'];

  if(endpoint.disabled) {
    console.log('Remote config is disabled.');
    return;
  }

  const wordPressApiUrl = endpoint.WordPressUrl+apiPath;

  //Check cache (and set cache for next time)
  let cacheMatch = true;
  for(let type of cacheObjects) {
    const cacheKey = wordPressApiUrl+'+'+type;

    const currentStatus = await WpApi_GetCacheItem_ByObjectType(wordPressApiUrl,type);
    const cacheItem = updateCache.get(cacheKey);
    updateCache.set(cacheKey,currentStatus);

    if(!cacheItem || JSON.stringify(cacheItem) !== JSON.stringify(currentStatus)) {
      cacheMatch = false;
    }
  }
  if(cacheMatch) {
    console.log('match cache for '+wordPressApiUrl);
    return;
  }

  const repoDetails = await gitRepo.getDetails();
  if(!repoDetails.data.permissions.push) {
    throw new Error('App user has no write permissions for '+gitHubTarget.Repo);
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
    /** @type {import('./common').WordpressMediaRow[]} */
    const allMedia = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl,'media');

    allMedia.forEach(x=>{
      /** @type {import('./common').GithubOutputJson} */
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
   * @param {import('./common').GithubOutputJson} jsonData 
   * @param {import('./common').WordpressPostRow | import('./common').WordpressPageRow | import('./common').WordpressMediaRow} WpRow 
   * @param {string} HTML 
   */
  const addMediaSection = (jsonData,WpRow,HTML) => {
    if(endpoint.SyncMedia) {
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
  /** @type {import('./common').WordpressPostRow[]} */
  const allPosts = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl,'posts');
  allPosts.forEach(x=>{
    /** @type {import('./common').GithubOutputJson} */
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
  /** @type {import('./common').WordpressPageRow[]} */
  const allPages = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl,'pages');
  allPages.forEach(x=>{
    /** @type {import('./common').GithubOutputJson} */
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
};

module.exports = {
  SyncEndpoint
};