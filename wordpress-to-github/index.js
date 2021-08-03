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
  pathFromMediaSourceUrl,
  addMediaSection
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
const cacheObjects = ['media', 'posts', 'pages'];

/**
 * process a Wordpress endpoint and place the data in GitHub
 * @param {import('./common').GitHubTarget} gitHubTarget
 * @param {import('./common').GitHubCredentials} gitHubCredentials
 */
const getRemoteConfig = async (gitHubTarget, gitHubCredentials) => {
  const gitModule = new GitHub(gitHubCredentials);

  // @ts-ignore
  const gitRepo = await gitModule.getRepo(gitHubTarget.Owner, gitHubTarget.Repo);

  /** @type {import('./common').EndpointConfigData} */
  const endpointConfig = (await gitRepo.getContents(gitHubTarget.Branch, gitHubTarget.ConfigPath, true)).data.data;

  return endpointConfig;
}

/**
 * 
 * @param {import('./gitTreeCommon').GithubTreeRow[]} tree 
 * @param {string[]} tags_exclude 
 */
const removeTreeItemsByTags = (tree, tags_exclude) => {
  const newTree = tree.filter(row=>{

    const json = JSON.parse(row.content);

    const tags = json.tags;

    return true;
    
  });
}


/**
 * process a Wordpress endpoint and place the data in GitHub
 * @param {import('./common').GitHubTarget} gitHubTarget
 * @param {import('./common').GitHubCredentials} gitHubCredentials
 * @param {import('./common').GitHubCommitter} gitHubCommitter
 */
const SyncEndpoint = async (gitHubTarget, gitHubCredentials, gitHubCommitter) => {
  const gitModule = new GitHub(gitHubCredentials);

  // @ts-ignore
  const gitRepo = await gitModule.getRepo(gitHubTarget.Owner, gitHubTarget.Repo);

  const endpointConfigData = await getRemoteConfig(gitHubTarget, gitHubCredentials);
  const wordPressApiUrl = endpointConfigData.wordpress_source_url + apiPath;

  const endpointConfigs = endpointConfigData.github_targets;

  //Check cache (and set cache for next time)
  let cacheMatch = true;
  for (let type of cacheObjects) {
    const cacheKey = wordPressApiUrl + '+' + type;

    const currentStatus = await WpApi_GetCacheItem_ByObjectType(wordPressApiUrl, type);
    const cacheItem = updateCache.get(cacheKey);
    updateCache.set(cacheKey, currentStatus);

    if (!cacheItem || JSON.stringify(cacheItem) !== JSON.stringify(currentStatus)) {
      cacheMatch = false;
    }
  }
  if (cacheMatch) {
    console.log('match cache for ' + wordPressApiUrl);
    return;
  }

  const repoDetails = await gitRepo.getDetails();
  if (!repoDetails.data.permissions.push) {
    throw new Error('App user has no write permissions for ' + gitHubTarget.Repo);
  }

  //List of WP categories
  const categorylist = await fetchDictionary(wordPressApiUrl, 'categories');
  const taglist = await fetchDictionary(wordPressApiUrl, 'tags');
  const userlist = await fetchDictionary(wordPressApiUrl, 'users');

  for (let endpointConfig of endpointConfigs) {
    if (endpointConfig.disabled) {
      console.log('Remote config is disabled.');
      continue;
    }

    /** @type {Map <string>} */
    const postMap = endpointConfig.PostPath ? new Map() : null;
    /** @type {Map <string>} */
    const pagesMap = endpointConfig.PagePath ? new Map() : null;
    /** @type {Map <string>} */
    const mediaMap = endpointConfig.MediaPath ? new Map() : null;

    // MEDIA
    const mediaContentPlaceholder = 'TBD : Binary file to be updated in a later step';
    if (mediaMap) {
      /** @type {import('./common').WordpressMediaRow[]} */
      const allMedia = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, 'media');

      allMedia.forEach(x => {
        /** @type {import('./common').GithubOutputJson} */
        const jsonData = {
          ...x,
          author: userlist[x.author],
          wordpress_url: ensureStringStartsWith(endpointConfigData.wordpress_source_url, x.source_url)
        };

        removeExcludedProperties(jsonData, endpointConfig.ExcludeProperties);

        if (x.media_details.sizes && Object.keys(x.media_details.sizes).length) {
          jsonData.sizes = Object.keys(x.media_details.sizes).map(s => ({
            type: s,
            path: pathFromMediaSourceUrl(x.media_details.sizes[s].source_url),
            wordpress_url: ensureStringStartsWith(endpointConfigData.wordpress_source_url, x.media_details.sizes[s].source_url),
            ...x.media_details.sizes[s]
          }));

          jsonData.sizes.sort((a, b) => b.width - a.width); //Big first

          //put binary placeholders so they aren't deleted.  Will search for these if an update happens.
          for (const s of jsonData.sizes) {
            mediaMap.set(s.path, mediaContentPlaceholder);
          }
        } else {
          //PDF
          jsonData.path = pathFromMediaSourceUrl(x.source_url);
          mediaMap.set(jsonData.path, mediaContentPlaceholder);
        }

        mediaMap.set(`${pathFromMediaSourceUrl(x.source_url).split('.')[0]}.json`, wrapInFileMeta(endpointConfigData.wordpress_source_url, gitHubTarget, fieldMetaReference.media, jsonData));
      });

      let mediaTree = await createTreeFromFileMap(gitRepo, gitHubTarget.Branch, mediaMap, endpointConfig.MediaPath);

      const mediaChanges = mediaTree
        .filter(x => x.content && x.content !== mediaContentPlaceholder)
        .map(mt => JSON.parse(mt.content).data);

      if (mediaChanges.length) {
        console.log(`Checking ${mediaTree.length} media items`);

        //Pull in binaries for any media meta changes
        for (const mediaTreeItem of mediaChanges) {
          if (mediaTreeItem.sizes) {
            //Sized images
            for (const sizeJson of mediaTreeItem.sizes) {
              await syncBinaryFile(sizeJson.wordpress_url, gitRepo, mediaTree, endpointConfig);
            }
          } else {
            //not sized media (PDF or non-image)
            await syncBinaryFile(mediaTreeItem.wordpress_url, gitRepo, mediaTree, endpointConfig);
          }
        }
      }

      //Remove any leftover binary placeholders...
      mediaTree = mediaTree.filter(x => x.content !== mediaContentPlaceholder);

      await PrIfChanged(gitRepo, gitHubTarget.Branch, mediaTree, `${commitTitleMedia} (${mediaTree.length} updates)`, gitHubCommitter, true);

    }

    /**
     * 
     * @param {import('./common').WordpressPostRow | import('./common').WordpressPageRow} jsonData 
     * @param {string} fieldName
     * @param {{}} dictionary
     * @returns {string[]}
     */
    const mapLookup = (jsonData, fieldName, dictionary) => {
      if (jsonData[fieldName]) {
        return jsonData[fieldName].map((/** @type {string | number} */ t) => dictionary[t])
      } else {
        return null
      }
    }

    /**
     * 
     * @param {import('./common').WordpressPostRow | import('./common').WordpressPageRow} wpRow 
     * @returns {import('./common').GithubOutputJson}
     */
    const wordPressRowToGitHubOutput = wpRow => {
      const jsonData = {
        ...wpRow,
        author: userlist[wpRow.author],
        wordpress_url: wpRow.link,
        categories: mapLookup(wpRow, 'categories', categorylist),
        tags: mapLookup(wpRow, 'tags', taglist),
      };

      if (!wpRow.categories) {
        delete jsonData.categories
      }
      if (!wpRow.tags) {
        delete jsonData.tags
      }

      return jsonData;
    }


    // POSTS
    if (endpointConfig.PostPath) {
      /** @type {import('./common').WordpressPostRow[]} */
      const allPosts = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, 'posts');
      allPosts.forEach(x => {
        const jsonData = wordPressRowToGitHubOutput(x);

        const HTML = cleanupContent(x.content);

        addMediaSection(endpointConfig, mediaMap, jsonData, HTML);

        removeExcludedProperties(jsonData, endpointConfig.ExcludeProperties);

        postMap.set(`${x.slug}.json`, wrapInFileMeta(endpointConfigData.wordpress_source_url, gitHubTarget, fieldMetaReference.posts, jsonData));
        postMap.set(`${x.slug}.html`, HTML);
      });

      const postTree = await createTreeFromFileMap(gitRepo, gitHubTarget.Branch, postMap, endpointConfig.PostPath);
      removeTreeItemsByTags(postTree,endpointConfig.tags_exclude);
      await PrIfChanged(gitRepo, gitHubTarget.Branch, postTree, `${commitTitlePosts} (${postTree.filter(x => x.path.endsWith(".html")).length} updates)`, gitHubCommitter, true);
    }
    // PAGES
    if (endpointConfig.PagePath) {
      /** @type {import('./common').WordpressPageRow[]} */
      const allPages = await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, 'pages');
      allPages.forEach(x => {
        const jsonData = wordPressRowToGitHubOutput(x);

        const HTML = cleanupContent(x.content);

        addMediaSection(endpointConfig, mediaMap, jsonData, HTML);

        removeExcludedProperties(jsonData, endpointConfig.ExcludeProperties);

        pagesMap.set(`${x.slug}.json`, wrapInFileMeta(endpointConfigData.wordpress_source_url, gitHubTarget, fieldMetaReference.media, jsonData));
        pagesMap.set(`${x.slug}.html`, HTML);
      });

      const pagesTree = await createTreeFromFileMap(gitRepo, gitHubTarget.Branch, pagesMap, endpointConfig.PagePath);
      removeTreeItemsByTags(pagesTree,endpointConfig.tags_exclude);
      await PrIfChanged(gitRepo, gitHubTarget.Branch, pagesTree, `${commitTitlePages} (${pagesTree.filter(x => x.path.endsWith(".html")).length} updates)`, gitHubCommitter, true);
    }
  }
};

module.exports = {
  SyncEndpoint
};