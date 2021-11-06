// @ts-check
// Updated 2021-10-18

const nowPacTime = (/** @type {Intl.DateTimeFormatOptions} */ options) =>
  new Date().toLocaleString("en-CA", {
    timeZone: "America/Los_Angeles",
    ...options
  });
const todayDateString = () =>
  nowPacTime({ year: "numeric", month: "2-digit", day: "2-digit" });
const todayTimeString = () =>
  nowPacTime({
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).replace(/:/g, "-");
/**
 * Halts processing for a set time
 *
 * @param {number} ms milliseconds to sleep (1000 = 1s)
 */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

//Git generates the SHA by concatenating a header in the form of blob {content.length} {null byte} and the contents of your file
const sha1 = require("sha1");
/**
 * Returns a Github equivalent sha hash for any given content
 * see https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
 *
 * @param {string} content string content to hash
 * @returns SHA Hash that would be used on Github for the given content
 */
const gitHubBlobPredictSha = content =>
  sha1(`blob ${Buffer.byteLength(content)}\0${content}`);

/**
 * Returns a Github equivalent sha hash for any given content
 * see https://git-scm.com/book/en/v2/Git-Internals-Git-Objects
 *
 * @param {Buffer} buffer buffer to hash
 * @returns SHA Hash that would be used on Github for the given content
 */
const gitHubBlobPredictShaFromBuffer = buffer =>
  sha1(
    Buffer.concat([Buffer.from(`blob ${buffer.byteLength}\0`, "utf8"), buffer])
  );
/**
 * @typedef {object} GithubTreeRow
 * @property {string} path
 * @property {string} mode usually '100644'
 * @property {string} type usually 'blob'
 * @property {string} [sha]
 * @property {string} [content]
 */

/**
 * @typedef {object} GithubPullRequest
 * @property {string} html_url
 * @property {number} number
 * @property {{ref:string}} head
 */

/**
 * @typedef {object} GithubCommit
 * @property {string} sha
 * @property {string} html_url
 * @property {string} message
 */

/**
 * @typedef {object} GithubCompareFile
 * @property {string} filename
 * @property {string} status
 */

/**
 * @typedef {object} CommitReport
 * @property {GithubCommit} Commit
 * @property {GithubCompareFile[]} Files
 */

/**
 * Creates a gitHub Tree array, skipping duplicates based on the outputpath
 *
 * @param {*} gitRepo from github-api
 * @param {string} masterBranch usually "master" or "main"
 * @param {Map<string,any>} filesMap contains the data to push
 * @param {string} outputPath the root path for all files
 * @param {boolean} [cleanoutputPath] true to delete all unmatched files in outputPath
 */
const createTreeFromFileMap = async (
  gitRepo,
  masterBranch,
  filesMap,
  outputPath,
  cleanoutputPath
) => {
  let treeUrl = "";
  if (outputPath) {
    //Path Tree

    const pathRootTree = outputPath.split("/").slice(0, -1).join("/"); //gets the parent folder to the output path
    /** @type {GithubTreeRow[]} */
    const rootTree = (await gitRepo.getSha(masterBranch, pathRootTree)).data;
    const referenceTreeRow = rootTree.find(f => f.path === outputPath);

    if (referenceTreeRow) {
      treeUrl = `${referenceTreeRow.sha}?recursive=true`;
    }
  } else {
    //Root Tree
    treeUrl = masterBranch;
  }

  const referenceTree = /** @type {{data:{tree:GithubTreeRow[]}}}} */ (
    await gitRepo.getTree(treeUrl)
  ).data.tree.filter(x => x.type === "blob");

  /** @type {GithubTreeRow[]} */
  const targetTree = [];
  //Tree parts...
  //https://docs.github.com/en/free-pro-team@latest/rest/reference/git#create-a-tree
  const mode = "100644"; //code for tree blob
  const type = "blob";

  for (const [key, value] of filesMap) {
    let existingFile = referenceTree.find(x => x.path === key);
    if (existingFile) {
      existingFile["found"] = true;
    }
    if (value) {
      //ignoring files with null value
      let content =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);

      if (!existingFile || existingFile.sha !== gitHubBlobPredictSha(content)) {
        let path = outputPath ? `${outputPath}/${key}` : key;

        targetTree.push({
          path,
          content,
          mode,
          type
        });
      }
    }
  }

  if (cleanoutputPath) {
    //process deletes
    for (const delme of referenceTree.filter(x => !x["found"])) {
      let path = outputPath ? `${outputPath}/${delme.path}` : delme.path;

      targetTree.push({
        path,
        mode,
        type,
        sha: null //will trigger a delete
      });
    }
  }

  return targetTree;
};

/**
 *  return a new PR if the tree has changes
 *
 * @param {*} gitRepo from github-api
 * @param {string} masterBranch usually "master" or "main"
 * @param {GithubTreeRow[]} tree from createTreeFromFileMap
 * @param {string} PrTitle the name of the new branch to create
 * @param {{name:string,email:string}} committer Github Name/Email
 * @param {boolean} commit_only true if skipping the PR process and just making a commit
 * @returns the new PR
 */
const CommitOrPrIfChanged = async (
  gitRepo,
  masterBranch,
  tree,
  PrTitle,
  committer,
  commit_only
) => {
  if (!tree.length) {
    return null;
  }

  const newBranchName = `${PrTitle}-${todayTimeString()}`.replace(/ /g, "_");
  let treeParts = [tree];
  const totalRows = tree.length;

  console.log(`Tree data is ${Buffer.byteLength(JSON.stringify(tree))} bytes`);

  //Split the tree into allowable sizes
  let evalIndex = 0;
  while (evalIndex < treeParts.length) {
    if (JSON.stringify(treeParts[evalIndex]).length > 9000000) {
      let half = Math.ceil(treeParts[evalIndex].length / 2);
      treeParts.unshift(treeParts[evalIndex].splice(0, half));
    } else {
      evalIndex++;
    }
  }

  //Grab the starting point for a fresh tree
  /** @type {{data:{object:{sha:string}}}} */
  const refResult = await gitRepo.getRef(`heads/${masterBranch}`);
  const baseSha = refResult.data.object.sha;

  //Loop through adding items to the tree
  let createTreeResult = { data: { sha: baseSha } };
  let rowCount = 0;
  for (let treePart of treeParts) {
    rowCount += treePart.length;
    console.log(
      `Creating tree for ${PrTitle} - ${rowCount}/${totalRows} items`
    );

    createTreeResult = await gitRepo.createTree(
      treePart,
      createTreeResult.data.sha
    );
  }

  //Create a commit the maps to all the tree changes
  /** @type {GithubCommit} */
  const commitResult = (
    await gitRepo.commit(baseSha, createTreeResult.data.sha, PrTitle, committer)
  ).data;
  const commitSha = commitResult.sha;

  //Compare the proposed commit with the trunk (master) branch
  /** @type {{files:GithubCompareFile[]}} */
  const compare = (await gitRepo.compareBranches(baseSha, commitSha)).data;
  if (compare.files.length) {
    console.log(`${compare.files.length} changes.`);

    if (commit_only) {
      console.log(`Commit created - ${commitResult.html_url}`);
      await gitRepo.updateHead(`heads/${masterBranch}`, commitSha);

      return {
        PullRequest: null,
        Commit: commitResult,
        Files: compare.files
      };
    } else {
      //Create a new branch and assign this commit to it, return the new branch.
      await gitRepo.createBranch(masterBranch, newBranchName);
      await gitRepo.updateHead(`heads/${newBranchName}`, commitSha);

      /** @type {GithubPullRequest} */
      const Pr = (
        await gitRepo.createPullRequest({
          title: PrTitle,
          head: newBranchName,
          base: masterBranch
        })
      ).data;

      console.log(`PR created - ${Pr.html_url}`);

      return {
        PullRequest: Pr,
        Commit: commitResult,
        Files: compare.files
      };
    }
  } else {
    console.log("no changes");
    return null;
  }
};

/**
 *  return a new PR if the tree has changes
 *
 * @param {*} gitRepo from github-api
 * @param {string} masterBranch usually "master" or "main"
 * @param {GithubTreeRow[]} tree from createTreeFromFileMap
 * @param {string} PrTitle the name of the new branch to create
 * @param {{name:string,email:string}} committer Github Name/Email
 * @param {boolean} [commit_only] deprecated
 * @returns the new PR
 */
const PrIfChanged = async (
  gitRepo,
  masterBranch,
  tree,
  PrTitle,
  committer,
  commit_only
) => {
  if (commit_only !== undefined) {
    throw new Error("commit_only is deprecated");
  }

  const PrResult = await CommitOrPrIfChanged(
    gitRepo,
    masterBranch,
    tree,
    PrTitle,
    committer,
    false
  );

  if (PrResult) return PrResult.PullRequest;
};

/**
 *  return a new PR if the tree has changes
 *
 * @param {*} gitRepo from github-api
 * @param {string} masterBranch usually "master" or "main"
 * @param {GithubTreeRow[]} tree from createTreeFromFileMap
 * @param {string} PrTitle the name of the new branch to create
 * @param {{name:string,email:string}} committer Github Name/Email
 * @returns the new PR
 */
const CommitIfChanged = async (
  gitRepo,
  masterBranch,
  tree,
  PrTitle,
  committer
) => {
  /** @type {CommitReport} */
  const Result = await CommitOrPrIfChanged(
    gitRepo,
    masterBranch,
    tree,
    PrTitle,
    committer,
    true
  );

  return Result;
};

module.exports = {
  createTreeFromFileMap,
  PrIfChanged,
  CommitIfChanged,
  todayDateString,
  todayTimeString,
  nowPacTime,
  sleep,
  gitHubBlobPredictSha,
  gitHubBlobPredictShaFromBuffer
};
