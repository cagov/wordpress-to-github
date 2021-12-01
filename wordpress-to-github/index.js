// @ts-check
const GitHub = require("github-api");
const {
  createTreeFromFileMap,
  CommitIfChanged,
  CommitReport
} = require("./gitTreeCommon");
const {
  ensureStringStartsWith,
  removeExcludedProperties,
  syncBinaryFile,
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

/**
 * process a Wordpress endpoint and place the data in GitHub
 *
 * @param {GitHubTarget} gitHubTarget
 * @param {GitHubCredentials} gitHubCredentials
 */
const getRemoteConfig = async (gitHubTarget, gitHubCredentials) => {
  const gitModule = new GitHub(gitHubCredentials);

  // @ts-ignore
  const gitRepo = await gitModule.getRepo(
    gitHubTarget.Owner,
    gitHubTarget.Repo
  );

  /** @type {EndpointConfigData} */
  const endpointConfig = (
    await gitRepo.getContents(
      gitHubTarget.Branch,
      gitHubTarget.ConfigPath,
      true
    )
  ).data.data;

  return endpointConfig;
};

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
 * @param {CommitReport[]} Report
 * @param {CommitReport} [CommitResult]
 */
const addToReport = (Report, CommitResult) => {
  if (CommitResult) {
    Report.push(CommitResult);
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
  /** @type {CommitReport[]} */
  const report = [];
  const gitModule = new GitHub(gitHubCredentials);

  // @ts-ignore
  const gitRepo = await gitModule.getRepo(
    gitHubTarget.Owner,
    gitHubTarget.Repo
  );

  const endpointConfig = await getRemoteConfig(gitHubTarget, gitHubCredentials);
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

  const repoDetails = await gitRepo.getDetails();
  if (!repoDetails.data.permissions.push) {
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

    const fileMap = new Map();
    fileMap.set(fileName, jsonData);
    const newTree = await createTreeFromFileMap(
      gitRepo,
      gitHubTarget.Branch,
      fileMap,
      filePath
    );

    addToReport(
      report,
      await CommitIfChanged(
        gitRepo,
        gitHubTarget.Branch,
        newTree,
        commitTitleGeneral,
        gitHubCommitter
      )
    );
  }

  /** @type {Map <string,any> | null} */
  const postMap = endpointConfig.PostPath ? new Map() : null;
  /** @type {Map <string,any> | null} */
  const pagesMap = endpointConfig.PagePath ? new Map() : null;
  /** @type {Map <string,any> | null} */
  const mediaMap = endpointConfig.MediaPath ? new Map() : null;

  // MEDIA
  const mediaContentPlaceholder =
    "TBD : Binary file to be updated in a later step";
  if (endpointConfig.MediaPath && mediaMap && allMedia) {
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

      /** @type {string} */
      const object_url = jsonData["_links"]?.self[0].href;

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
          mediaMap.set(s.path, mediaContentPlaceholder);
        }
      }
      //PDF
      jsonData.path = pathFromMediaSourceUrl(x.source_url);
      mediaMap.set(jsonData.path, mediaContentPlaceholder);
      mediaMap.set(
        pathFromMediaSourceUrl(x.source_url).replace(/\.([^.]+)$/, ".json"),
        wrapInFileMeta(
          sourceEndpointConfig.WordPressSource.url,
          gitHubTarget,
          fieldMetaReference.media,
          jsonData,
          object_url
        )
      );
    });

    let mediaTree = await createTreeFromFileMap(
      gitRepo,
      gitHubTarget.Branch,
      mediaMap,
      endpointConfig.MediaPath,
      true
    );

    const mediaChanges = mediaTree
      .filter(x => x.content && x.content !== mediaContentPlaceholder)
      .map(mt => JSON.parse(mt.content).data);

    if (mediaChanges.length) {
      console.log(`Checking ${mediaTree.length} media items`);

      /** @type {Promise<void>[]} */
      const binarySyncs = [];

      //Pull in binaries for any media meta changes
      for (const mediaTreeItem of mediaChanges) {
        if (mediaTreeItem.sizes) {
          //Sized images
          for (const sizeJson of mediaTreeItem.sizes) {
            binarySyncs.push(
              syncBinaryFile(
                sizeJson.wordpress_url,
                gitRepo,
                mediaTree,
                endpointConfig
              )
            );
          }
        }

        //not sized media (PDF or non-image)
        binarySyncs.push(
          syncBinaryFile(
            mediaTreeItem.wordpress_url,
            gitRepo,
            mediaTree,
            endpointConfig
          )
        );
      }

      await Promise.all(binarySyncs);
    }

    //Remove any leftover binary placeholders...
    mediaTree = mediaTree.filter(x => x.content !== mediaContentPlaceholder);
    addToReport(
      report,
      await CommitIfChanged(
        gitRepo,
        gitHubTarget.Branch,
        mediaTree,
        `${commitTitleMedia} (${mediaTree.length} updates)`,
        gitHubCommitter
      )
    );
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

      /** @type {string} */
      const object_url = jsonData["_links"]?.self[0].href;

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

      /** @type {string} */
      const object_url = jsonData["_links"]?.self[0].href;

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
