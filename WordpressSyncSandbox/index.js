// @ts-check
const {
  slackBotReportError,
  slackBotChatPost,
  slackBotReplyPost,
  slackBotReactionAdd
} = require("../common/slackBot");
const debugChannel = "C01H6RB99E2"; //#carter-dev

const sample = {
  method: "POST",
  url: "https://fa-go-univ-wp-ghub-001.azurewebsites.net/WordpressSyncHttpTrigger?code=3pIByXsH8JqJRMz/Ymt2yOh0nfDzhEp8jLgcdf06DFlN9LPTiIWUAw==",
  originalUrl:
    "https://fa-go-univ-wp-ghub-001.azurewebsites.net/WordpressSyncHttpTrigger?code=3pIByXsH8JqJRMz/Ymt2yOh0nfDzhEp8jLgcdf06DFlN9LPTiIWUAw==",
  headers: {
    connection: "Keep-Alive",
    "content-type": "application/json",
    accept: "*/*",
    "accept-encoding": "deflate,gzip,br",
    host: "fa-go-univ-wp-ghub-001.azurewebsites.net",
    "max-forwards": "9",
    referer:
      "https://fa-go-univ-wp-ghub-001.azurewebsites.net/?code=3pIByXsH8JqJRMz/Ymt2yOh0nfDzhEp8jLgcdf06DFlN9LPTiIWUAw==",
    "user-agent":
      "WordPress/5.8.1; https://live-drought-ca-gov.pantheonsite.io",
    "content-length": "419",
    "x-waws-unencoded-url":
      "/?code=3pIByXsH8JqJRMz/Ymt2yOh0nfDzhEp8jLgcdf06DFlN9LPTiIWUAw==",
    "client-ip": "10.0.128.41:61220",
    "x-arr-log-id": "b2a329df-c345-42de-8685-b0160fd615fe",
    "x-site-deployment-id": "FA-GO-UNIV-WP-GHUB-001",
    "was-default-hostname": "fa-go-univ-wp-ghub-001.azurewebsites.net",
    "x-original-url":
      "/?code=3pIByXsH8JqJRMz/Ymt2yOh0nfDzhEp8jLgcdf06DFlN9LPTiIWUAw==",
    "x-forwarded-for": "35.225.201.234:55084,127.0.0.1",
    "x-arr-ssl":
      "2048|256|C=US, O=Microsoft Corporation, CN=Microsoft RSA TLS CA 02|CN=*.azurewebsites.net",
    "x-forwarded-proto": "https",
    "x-appservice-proto": "https",
    "x-forwarded-tlsversion": "1.2",
    "disguised-host": "fa-go-univ-wp-ghub-001.azurewebsites.net"
  },
  query: {
    code: "3pIByXsH8JqJRMz/Ymt2yOh0nfDzhEp8jLgcdf06DFlN9LPTiIWUAw=="
  },
  params: {},
  body: {
    trigger: "Post saved as a draft",
    home_url: "https://live-drought-ca-gov.pantheonsite.io",
    site_title: "California drought action",
    site_tagline:
      "Learn more about current conditions, the state's response and informational resources available to the public.",
    editor: "carter-medlin",
    slug: "__trashed",
    title: "Carter Draft Test",
    tags: "",
    category: "Uncategorized"
  },
  rawBody:
    '{\r\n  "trigger": "Post saved as a draft"\r\n  ,"home_url": "https://live-drought-ca-gov.pantheonsite.io"\r\n  ,"site_title": "California drought action"\r\n  ,"site_tagline": "Learn more about current conditions, the state\'s response and informational resources available to the public."\r\n  ,"editor": "carter-medlin"\r\n  ,"slug": "__trashed"\r\n  ,"title": "Carter Draft Test"\r\n  ,"tags": ""\r\n  ,"category": "Uncategorized"\r\n}'
};

module.exports = async function (context, req) {
  let slackPostTS = "";

  const samplePayload = {
    "user-agent": sample.headers["user-agent"],
    host: sample.headers.host,
    url: sample.url,
    "x-original-url": sample.headers["x-original-url"],
    body: sample.body
  };

  const responseOutput = JSON.stringify(samplePayload, null, 2).replace(
    new RegExp(sample.query.code, "g"),
    `${sample.query?.code?.substring(0, 3)}[...]`
  );

  const debugInfo = {
    context,
    req
  };

  try {
    slackPostTS = (
      await (await slackBotChatPost(debugChannel, "Work recorded")).json()
    ).ts;

    await slackBotReplyPost(
      debugChannel,
      slackPostTS,
      `\n\n*Request Info*\n\`\`\`${responseOutput}\`\`\``
    );

    const yo = require("@cagov/wordpress-to-github");

    context.res = {
      body: `${JSON.stringify(req, null, 2)}`
    };
  } catch (e) {
    await slackBotReplyPost(
      debugChannel,
      slackPostTS,
      `\n\n*Error Details*\n\`\`\`${e.stack}\`\`\``
    );

    context.res = {
      status: 500,
      body: `Error - ${e.message}\n${e.stack}`
    };
  }
};
