"use strict";

require("dotenv").config();
const config = require("./lib/config");
const { PortalSession, extractCsrf } = require("./lib/portal/session");

async function main() {
  const session = new PortalSession({
    baseUrl: config.portalBaseUrl,
    username: config.portalUsername,
    password: config.portalPassword,
    loginPath: config.portalLoginPath,
    timeoutMs: 30000,
    maxConcurrent: 1,
  });

  const loginPage = await session._fetch("https://unihotel.org/login-page/");
  const csrf = extractCsrf(await loginPage.text());
  const form = new URLParams({
    useremail: config.portalUsername,
    userpassword: config.portalPassword,
    csrfmiddlewaretoken: csrf,
  });
  const post = await session._fetch("https://unihotel.org/ajax-login/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-CSRFToken": csrf,
      Referer: "https://unihotel.org/login-page/",
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://unihotel.org",
    },
    body: form.toString(),
  });
  console.log("login", post.status, (await post.text()).slice(0, 200));
  session.csrfToken = csrf;

  for (const path of ["/profile/", "/"]) {
    const res = await session._fetch("https://unihotel.org" + path, { followRedirects: true });
    const text = await res.text();
    console.log(
      path,
      res.status,
      "len",
      text.length,
      "logout",
      text.includes("/logout/"),
      "login-form",
      text.includes("userpassword")
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});