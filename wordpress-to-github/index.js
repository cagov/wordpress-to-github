// @ts-check
const { GitHubTreePush, GithubCompare } = require("@cagov/github-tree-push");
const {
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
  addMediaSection,
  GitHubTarget,
  GitHubCredentials,
  EndpointConfigData,
  SourceEndpointConfigData,
  WordpressApiDateCacheItem,
  WordpressApiHashCacheItem,
  GitHubCommitter,
  GithubOutputJson,
  WordpressMediaRow,
  WordpressPageRow,
  WordpressPostRow
} = require("./common");
const commitTitlePosts = "Wordpress Posts Update";
const commitTitlePages = "Wordpress Pages Update";
const commitTitleMedia = "Wordpress Media Update";
const commitTitleApiRequests = "Wordpress API Requests Update";
const commitTitleGeneral = "Wordpress General File Update";
const fieldMetaReference = {
  posts: "https://developer.wordpress.org/rest-api/reference/posts/",
  pages: "https://developer.wordpress.org/rest-api/reference/pages/",
  media: "https://developer.wordpress.org/rest-api/reference/pages/"
};
/** @type {Map <string,WordpressApiDateCacheItem|WordpressApiHashCacheItem>} */
const updateCache = new Map();
const cacheObjects = ["media", "posts", "pages"];
const fetch = require("fetch-retry")(require("node-fetch/lib"), {
  retries: 3,
  retryDelay: 2000
});

/**
 * returns true if there are any items that match in both arrays
 *
 * @param {any[]} [array1]
 * @param {any[]} [array2]
 */
const anythingInArrayMatch = (array1, array2) =>
  Array.isArray(array1) &&
  Array.isArray(array2) &&
  array1.some(s => array2.includes(s));

/**
 * @typedef {object} WordpressToGithubReportRow
 * @property {string} commit_html_url
 */

/**
 * Addts a CommitResult to the Report if it exists
 *
 * @param {GithubCompare[]} Report
 * @param {GitHubTreePush} Tree
 */
const addToReport = (Report, Tree) => {
  if (Tree.lastCompare) {
    Report.push(Tree.lastCompare);
  }
};

/**
 * process a Wordpress endpoint and place the data in GitHub
 *
 * @param {GitHubTarget} gitHubTarget
 * @param {SourceEndpointConfigData} sourceEndpointConfig
 * @param {GitHubCredentials} gitHubCredentials
 * @param {GitHubCommitter} gitHubCommitter
 */
const SyncEndpoint = async (
  gitHubTarget,
  sourceEndpointConfig,
  gitHubCredentials,
  gitHubCommitter
) => {
  /** @type {GithubCompare[]} */
  const report = [];

  const configTreeConfig = {
    owner: gitHubTarget.Owner,
    base: gitHubTarget.Branch,
    repo: gitHubTarget.Repo
  };

  const configTree = new GitHubTreePush(
    gitHubCredentials.token,
    configTreeConfig
  );

  //https://docs.github.com/en/rest/reference/repos#contents
  const endpointConfigResponse = await configTree.__fetchResponse(
    `/contents/${gitHubTarget.ConfigPath}?ref=${configTreeConfig.base}`,
    configTree.__gitDefaultOptions({
      headers: { Accept: "application/vnd.github.v3.raw" }
    })
  );

  /** @type {EndpointConfigData} */
  const endpointConfig = (await endpointConfigResponse.json()).data;
  const wordPressApiUrl = sourceEndpointConfig.WordPressSource.url + apiPath;

  const allApiRequests =
    endpointConfig.ApiRequests && endpointConfig.ApiRequests.length
      ? await WpApi_GetApiRequestsData(
          sourceEndpointConfig.WordPressSource.url,
          endpointConfig.ApiRequests
        )
      : null;

  //Check cache (and set cache for next time)
  let cacheMatch = true;
  const cacheRoot = `Owner:${gitHubTarget.Owner},Repo:${gitHubTarget.Repo},Branch:${gitHubTarget.Branch},wordPressApiUrl:${wordPressApiUrl}`;

  for (let type of cacheObjects) {
    const cacheKey = `${cacheRoot},type:${type}`;
    const cacheItem = updateCache.get(cacheKey);
    const currentStatus = await WpApi_GetCacheItem_ByObjectType(
      wordPressApiUrl,
      type
    );

    updateCache.set(cacheKey, currentStatus);

    if (jsonCacheDiscrepancy(cacheItem, currentStatus)) {
      cacheMatch = false;
    }
  }

  if (allApiRequests) {
    for (let request of allApiRequests) {
      const apiRequestCacheKey = `${cacheRoot},type:apiResponse:${request.Destination}`;
      const apiRequestCacheItem = updateCache.get(apiRequestCacheKey);
      // eslint-disable-next-line no-unused-vars
      const { Data, ...apiCurrentStatus } = request;

      updateCache.set(apiRequestCacheKey, apiCurrentStatus);

      if (jsonCacheDiscrepancy(apiRequestCacheItem, apiCurrentStatus)) {
        cacheMatch = false;
      }
    }
  }

  if (cacheMatch) {
    console.log(`match cache for ${cacheRoot}`);
    return;
  }

  //https://docs.github.com/en/rest/reference/repos#get-a-repository

  const repoDetails = await configTree.__getSomeJson("");

  if (!repoDetails.permissions.push) {
    throw new Error(
      `App user has no write permissions for ${gitHubTarget.Repo}`
    );
  }

  //List of WP categories
  const categorylist = await fetchDictionary(wordPressApiUrl, "categories");
  const taglist = await fetchDictionary(wordPressApiUrl, "tags");
  const userlist = endpointConfig.HideAuthorName
    ? null
    : await fetchDictionary(wordPressApiUrl, "users");

  /** @type {WordpressMediaRow[] | null} */
  const allMedia = endpointConfig.MediaPath
    ? await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, "media")
    : null;
  /** @type {WordpressPostRow[] | null} */
  const allPosts = endpointConfig.PostPath
    ? await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, "posts")
    : null;
  /** @type {WordpressPageRow[] | null} */
  const allPages = endpointConfig.PagePath
    ? await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, "pages")
    : null;

  if (endpointConfig.disabled) {
    console.log("Remote config is disabled.");
    return;
  }

  if (endpointConfig.GeneralFilePath) {
    const targetUrl = `${sourceEndpointConfig.WordPressSource.url}/wp-json?_fields=description,gmt_offset,name,namespaces,timezone_string,home,url`;
    const fetchResponse = await WpApi_getSomething(
      `${targetUrl}&cachebust=${Math.random()}`
    );

    const data = await fetchResponse.json();
    delete data._links;

    const jsonData = {
      meta: {
        ...commonMeta(
          sourceEndpointConfig.WordPressSource.url,
          gitHubTarget,
          targetUrl
        )
      },
      data
    };
    const filePath = endpointConfig.GeneralFilePath.split("/")
      .slice(0, -1)
      .join("/");
    const fileName = endpointConfig.GeneralFilePath.split("/").slice(-1)[0];

    const generalTree = new GitHubTreePush(gitHubCredentials.token, {
      ...configTreeConfig,
      path: filePath,
      commit_message: commitTitleGeneral
    });

    generalTree.syncFile(fileName, jsonData);
    await generalTree.treePush();

    addToReport(report, generalTree);
  }

  /** @type {Map <string,any> | null} */
  const postMap = endpointConfig.PostPath ? new Map() : null;
  /** @type {Map <string,any> | null} */
  const pagesMap = endpointConfig.PagePath ? new Map() : null;
  /** @type {Map <string,any> | null} */
  const mediaMap = endpointConfig.MediaPath ? new Map() : null;

  // MEDIA
  if (endpointConfig.MediaPath && mediaMap && allMedia) {
    const mediaTree = new GitHubTreePush(gitHubCredentials.token, {
      ...configTreeConfig,
      path: endpointConfig.MediaPath,
      commit_message: commitTitleMedia
    });

    allMedia.forEach(x => {
      /** @type {GithubOutputJson} */
      const jsonData = {
        ...x,
        author: userlist ? userlist[x.author] : x.author,
        wordpress_url: ensureStringStartsWith(
          sourceEndpointConfig.WordPressSource.url,
          x.source_url
        )
      };

      const object_url = jsonData._links?.self[0].href;

      removeExcludedProperties(jsonData, endpointConfig.ExcludeProperties);

      if (x.media_details.sizes && Object.keys(x.media_details.sizes).length) {
        jsonData.sizes = Object.keys(x.media_details.sizes).map(s => ({
          type: s,
          path: pathFromMediaSourceUrl(x.media_details.sizes[s].source_url),
          wordpress_url: ensureStringStartsWith(
            sourceEndpointConfig.WordPressSource.url,
            x.media_details.sizes[s].source_url
          ),
          ...x.media_details.sizes[s]
        }));

        jsonData.sizes.sort((a, b) => b.width - a.width); //Big first

        //put binary placeholders so they aren't deleted.  Will search for these if an update happens.
        for (const s of jsonData.sizes) {
          mediaTree.doNotRemoveFile(s.path);
        }
      }
      //PDF
      jsonData.path = pathFromMediaSourceUrl(x.source_url);
      mediaTree.doNotRemoveFile(jsonData.path);

      const mediaJson = wrapInFileMeta(
        sourceEndpointConfig.WordPressSource.url,
        gitHubTarget,
        fieldMetaReference.media,
        jsonData,
        object_url
      );

      const mediaPath = pathFromMediaSourceUrl(x.source_url).replace(
        /\.([^.]+)$/,
        ".json"
      );

      mediaTree.syncFile(mediaPath, mediaJson);

      mediaMap.set(mediaPath, mediaJson);
    });

    //TODO: Need to figure out which meta files changed...

    const mediaChanges = (await mediaTree.treePushDryRun()).map(
      p => mediaMap.get(p.replace(`${endpointConfig.MediaPath}/`, "")).data
    );

    if (mediaChanges.length) {
      console.log(`Checking ${mediaChanges.length} media items`);

      /** @type {Promise<void>[]} */
      const binarySyncs = [];

      //Pull in binaries for any media meta changes
      for (const mediaTreeItem of mediaChanges) {
        if (mediaTreeItem.sizes) {
          //Sized images
          for (const sizeJson of mediaTreeItem.sizes) {
            const wordpress_url = sizeJson.wordpress_url;

            console.log(`Downloading...${wordpress_url}`);
            const fetchResponse = await fetch(wordpress_url);
            const blob = await fetchResponse.arrayBuffer();
            const buffer = Buffer.from(blob);

            const path = pathFromMediaSourceUrl(wordpress_url);

            mediaTree.syncFile(path, buffer);
          }
        }

        //not sized media (PDF or non-image)
        const wordpress_url = mediaTreeItem.wordpress_url;

        console.log(`Downloading...${wordpress_url}`);
        const fetchResponse = await fetch(wordpress_url);
        const blob = await fetchResponse.arrayBuffer();
        const buffer = Buffer.from(blob);

        const path = pathFromMediaSourceUrl(wordpress_url);

        mediaTree.syncFile(path, buffer);
      }

      await Promise.all(binarySyncs);
    }

    await mediaTree.treePush();
    addToReport(report, mediaTree);
  }

  /**
   *
   * @param {*} jsonData
   * @param {string} fieldName
   * @param {any} dictionary
   * @returns {string[] | undefined}
   */
  const mapLookup = (jsonData, fieldName, dictionary) => {
    if (jsonData[fieldName]) {
      return jsonData[fieldName].map(
        (/** @type {string | number} */ t) => dictionary[t]
      );
    } else {
      return undefined;
    }
  };

  /**
   *
   * @param {WordpressPostRow | WordpressPageRow} wpRow
   * @returns {GithubOutputJson}
   */
  const wordPressRowToGitHubOutput = wpRow => {
    const jsonData = {
      ...wpRow,
      author: userlist ? userlist[wpRow.author] : wpRow.author,
      wordpress_url: wpRow.link,
      categories: mapLookup(wpRow, "categories", categorylist),
      tags: mapLookup(wpRow, "tags", taglist)
    };

    if (!wpRow.categories) {
      delete jsonData.categories;
    }
    if (!wpRow.tags) {
      delete jsonData.tags;
    }

    return jsonData;
  };

  // POSTS
  if (endpointConfig.PostPath && postMap && allPosts) {
    allPosts.forEach(x => {
      const jsonData = wordPressRowToGitHubOutput(x);

      const HTML = cleanupContent(x.content);

      addMediaSection(endpointConfig, mediaMap, jsonData, HTML);

      const object_url = jsonData._links?.self[0].href;

      removeExcludedProperties(jsonData, endpointConfig.ExcludeProperties);

      const ignoreThisOne = anythingInArrayMatch(
        jsonData.tags,
        sourceEndpointConfig.WordPressSource.tags_exclude
      );

      postMap.set(
        `${x.slug}.json`,
        ignoreThisOne
          ? null
          : wrapInFileMeta(
              sourceEndpointConfig.WordPressSource.url,
              gitHubTarget,
              fieldMetaReference.posts,
              jsonData,
              object_url
            )
      );
      postMap.set(`${x.slug}.html`, ignoreThisOne ? null : HTML);
    });

    const postTree = await createTreeFromFileMap(
      gitRepo,
      gitHubTarget.Branch,
      postMap,
      endpointConfig.PostPath,
      true
    );
    addToReport(
      report,
      await CommitIfChanged(
        gitRepo,
        gitHubTarget.Branch,
        postTree,
        `${commitTitlePosts} (${
          postTree.filter(x => x.path.endsWith(".html")).length
        } updates)`,
        gitHubCommitter
      )
    );
  }
  // PAGES
  if (endpointConfig.PagePath && pagesMap && allPages) {
    allPages.forEach(x => {
      const jsonData = wordPressRowToGitHubOutput(x);

      const HTML = cleanupContent(x.content);

      addMediaSection(endpointConfig, mediaMap, jsonData, HTML);

      const object_url = jsonData._links?.self[0].href;

      removeExcludedProperties(jsonData, endpointConfig.ExcludeProperties);

      const ignoreThisOne = anythingInArrayMatch(
        jsonData.tags,
        sourceEndpointConfig.WordPressSource.tags_exclude
      );

      pagesMap.set(
        `${x.slug}.json`,
        ignoreThisOne
          ? null
          : wrapInFileMeta(
              sourceEndpointConfig.WordPressSource.url,
              gitHubTarget,
              fieldMetaReference.media,
              jsonData,
              object_url
            )
      );
      pagesMap.set(`${x.slug}.html`, ignoreThisOne ? null : HTML);
    });

    const pagesTree = await createTreeFromFileMap(
      gitRepo,
      gitHubTarget.Branch,
      pagesMap,
      endpointConfig.PagePath,
      true
    );
    addToReport(
      report,
      await CommitIfChanged(
        gitRepo,
        gitHubTarget.Branch,
        pagesTree,
        `${commitTitlePages} (${
          pagesTree.filter(x => x.path.endsWith(".html")).length
        } updates)`, //TODO: Pull from a name property
        gitHubCommitter
      )
    );
  }

  // API Requests
  if (allApiRequests) {
    // Group all destination files by their parent folders.
    const apiRequestsByFolder = allApiRequests.reduce((bucket, request) => {
      let folderName = request.Destination.split("/").slice(0, -1).join("/");
      let fileName = request.Destination.split("/").slice(-1)[0];

      if (!(folderName in bucket)) {
        bucket[folderName] = new Map();
      }

      bucket[folderName].set(fileName, JSON.stringify(request.Data, null, 2));

      return bucket;
    }, {});

    // Create and commit a git tree for each set of files.
    for (let [folderName, fileMap] of Object.entries(apiRequestsByFolder)) {
      const requestsTree = await createTreeFromFileMap(
        gitRepo,
        gitHubTarget.Branch,
        fileMap,
        folderName,
        false
      );

      const reportLabel = folderName.split("/").slice(-1).join("/") || "root";
      const updateCount = `${requestsTree.length} ${
        requestsTree.length === 1 ? "update" : "updates"
      }`;

      addToReport(
        report,
        await CommitIfChanged(
          gitRepo,
          gitHubTarget.Branch,
          requestsTree,
          `${commitTitleApiRequests} (${updateCount} to ${reportLabel})`,
          gitHubCommitter
        )
      );
    }
  }

  return report;
};

module.exports = {
  SyncEndpoint
};
