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
  GitHubCommitter,
  GithubOutputJson,
  WordpressMediaRow,
  WordpressPageRow,
  WordpressPostRow
} = require("./common");
const commitTitlePosts = "Wordpress Posts Update";
const commitTitlePages = "Wordpress Pages Update";
const commitTitleMedia = "Wordpress Media Update";
const commitTitleGeneral = "Wordpress General File Update";
const fieldMetaReference = {
  posts: "https://developer.wordpress.org/rest-api/reference/posts/",
  pages: "https://developer.wordpress.org/rest-api/reference/pages/",
  media: "https://developer.wordpress.org/rest-api/reference/pages/"
};
/** @type {Map <string,WordpressApiDateCacheItem>} */
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
  ).data.data.github_targets[0];

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
 * @param {SourceEndpointConfigData} sourceEndpointConfig
 * @param {GitHubCredentials} gitHubCredentials
 * @param {GitHubCommitter} gitHubCommitter
 */
const SyncEndpoint = async (
  sourceEndpointConfig,
  gitHubCredentials,
  gitHubCommitter
) => {
  /** @type {CommitReport[]} */
  const report = [];
  const gitModule = new GitHub(gitHubCredentials);

  // @ts-ignore
  const gitRepo = await gitModule.getRepo(
    sourceEndpointConfig.GitHubTarget.Owner,
    sourceEndpointConfig.GitHubTarget.Repo
  );

  const endpointConfigData = await getRemoteConfig(
    sourceEndpointConfig.GitHubTarget,
    gitHubCredentials
  );
  const wordPressApiUrl = sourceEndpointConfig.WordPressSource.url + apiPath;

  //Check cache (and set cache for next time)
  let cacheMatch = true;
  for (let type of cacheObjects) {
    const cacheKey = `${wordPressApiUrl}+${type}`;

    const currentStatus = await WpApi_GetCacheItem_ByObjectType(
      wordPressApiUrl,
      type
    );
    const cacheItem = updateCache.get(cacheKey);
    updateCache.set(cacheKey, currentStatus);

    if (
      !cacheItem ||
      JSON.stringify(cacheItem) !== JSON.stringify(currentStatus)
    ) {
      cacheMatch = false;
    }
  }
  if (cacheMatch) {
    console.log(`match cache for ${wordPressApiUrl}`);
    return;
  }

  const repoDetails = await gitRepo.getDetails();
  if (!repoDetails.data.permissions.push) {
    throw new Error(
      `App user has no write permissions for ${sourceEndpointConfig.GitHubTarget.Repo}`
    );
  }

  //List of WP categories
  const categorylist = await fetchDictionary(wordPressApiUrl, "categories");
  const taglist = await fetchDictionary(wordPressApiUrl, "tags");
  const userlist = await fetchDictionary(wordPressApiUrl, "users");

  /** @type {WordpressMediaRow[] | null} */
  const allMedia = endpointConfigData.MediaPath
    ? await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, "media")
    : null;
  /** @type {WordpressPostRow[] | null} */
  const allPosts = endpointConfigData.PostPath
    ? await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, "posts")
    : null;
  /** @type {WordpressPageRow[] | null} */
  const allPages = endpointConfigData.PagePath
    ? await WpApi_GetPagedData_ByObjectType(wordPressApiUrl, "pages")
    : null;

    if (endpointConfigData.disabled) {
      console.log("Remote config is disabled.");
      return;
    }

    if (endpointConfigData.GeneralFilePath) {
      const fetchResponse = await WpApi_getSomething(
        `${
          sourceEndpointConfig.WordPressSource.url
        }/wp-json/?_fields=description,gmt_offset,name,namespaces,timezone_string,home,url&cachebust=${Math.random()}`
      );

      const data = await fetchResponse.json();
      delete data._links;

      const jsonData = {
        meta: {
          ...commonMeta(
            sourceEndpointConfig.WordPressSource.url,
            sourceEndpointConfig.GitHubTarget
          )
        },
        data
      };
      const filePath = endpointConfigData.GeneralFilePath.split("/")
        .slice(0, -1)
        .join("/");
      const fileName = endpointConfigData.GeneralFilePath.split("/").slice(-1)[0];

      const fileMap = new Map();
      fileMap.set(fileName, jsonData);
      const newTree = await createTreeFromFileMap(
        gitRepo,
        sourceEndpointConfig.GitHubTarget.Branch,
        fileMap,
        filePath,
        true
      );

      addToReport(
        report,
        await CommitIfChanged(
          gitRepo,
          sourceEndpointConfig.GitHubTarget.Branch,
          newTree,
          commitTitleGeneral,
          gitHubCommitter
        )
      );
    }

    /** @type {Map <string,any> | null} */
    const postMap = endpointConfigData.PostPath ? new Map() : null;
    /** @type {Map <string,any> | null} */
    const pagesMap = endpointConfigData.PagePath ? new Map() : null;
    /** @type {Map <string,any> | null} */
    const mediaMap = endpointConfigData.MediaPath ? new Map() : null;

    // MEDIA
    const mediaContentPlaceholder =
      "TBD : Binary file to be updated in a later step";
    if (endpointConfigData.MediaPath && mediaMap && allMedia) {
      allMedia.forEach(x => {
        /** @type {GithubOutputJson} */
        const jsonData = {
          ...x,
          author: userlist[x.author.toString()],
          wordpress_url: ensureStringStartsWith(
            sourceEndpointConfig.WordPressSource.url,
            x.source_url
          )
        };

        removeExcludedProperties(jsonData, endpointConfigData.ExcludeProperties);

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
            sourceEndpointConfig.GitHubTarget,
            fieldMetaReference.media,
            jsonData
          )
        );
      });

      let mediaTree = await createTreeFromFileMap(
        gitRepo,
        sourceEndpointConfig.GitHubTarget.Branch,
        mediaMap,
        endpointConfigData.MediaPath,
        true
      );

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
              await syncBinaryFile(
                sizeJson.wordpress_url,
                gitRepo,
                mediaTree,
                endpointConfigData
              );
            }
          }

          //not sized media (PDF or non-image)
          await syncBinaryFile(
            mediaTreeItem.wordpress_url,
            gitRepo,
            mediaTree,
            endpointConfigData
          );
        }
      }

      //Remove any leftover binary placeholders...
      mediaTree = mediaTree.filter(x => x.content !== mediaContentPlaceholder);
      addToReport(
        report,
        await CommitIfChanged(
          gitRepo,
          sourceEndpointConfig.GitHubTarget.Branch,
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
        author: userlist[wpRow.author],
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
    if (endpointConfigData.PostPath && postMap && allPosts) {
      allPosts.forEach(x => {
        const jsonData = wordPressRowToGitHubOutput(x);

        const HTML = cleanupContent(x.content);

        addMediaSection(endpointConfigData, mediaMap, jsonData, HTML);

        removeExcludedProperties(jsonData, endpointConfigData.ExcludeProperties);

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
                sourceEndpointConfig.GitHubTarget,
                fieldMetaReference.posts,
                jsonData
              )
        );
        postMap.set(`${x.slug}.html`, ignoreThisOne ? null : HTML);
      });

      const postTree = await createTreeFromFileMap(
        gitRepo,
        sourceEndpointConfig.GitHubTarget.Branch,
        postMap,
        endpointConfigData.PostPath,
        true
      );
      addToReport(
        report,
        await CommitIfChanged(
          gitRepo,
          sourceEndpointConfig.GitHubTarget.Branch,
          postTree,
          `${commitTitlePosts} (${
            postTree.filter(x => x.path.endsWith(".html")).length
          } updates)`,
          gitHubCommitter
        )
      );
    }
    // PAGES
    if (endpointConfigData.PagePath && pagesMap && allPages) {
      allPages.forEach(x => {
        const jsonData = wordPressRowToGitHubOutput(x);

        const HTML = cleanupContent(x.content);

        addMediaSection(endpointConfigData, mediaMap, jsonData, HTML);

        removeExcludedProperties(jsonData, endpointConfigData.ExcludeProperties);

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
                sourceEndpointConfig.GitHubTarget,
                fieldMetaReference.media,
                jsonData
              )
        );
        pagesMap.set(`${x.slug}.html`, ignoreThisOne ? null : HTML);
      });

      const pagesTree = await createTreeFromFileMap(
        gitRepo,
        sourceEndpointConfig.GitHubTarget.Branch,
        pagesMap,
        endpointConfigData.PagePath,
        true
      );
      addToReport(
        report,
        await CommitIfChanged(
          gitRepo,
          sourceEndpointConfig.GitHubTarget.Branch,
          pagesTree,
          `${commitTitlePages} (${
            pagesTree.filter(x => x.path.endsWith(".html")).length
          } updates)`,
          gitHubCommitter
        )
      );
    } 

  return report;
};

module.exports = {
  SyncEndpoint
};
