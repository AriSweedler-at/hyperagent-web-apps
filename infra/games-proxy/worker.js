// Cloudflare Worker serving the GitHub Pages site at https://games.sweedler.com.
//   /            -> arisweedler-at.github.io/hyperagent-web-apps/
//   /XXX         -> .../hyperagent-web-apps/games/XXX      (short game URLs)
//   /games/XXX   -> 301 to /XXX                            (landing-page links)
//   /shared/…    -> .../hyperagent-web-apps/shared/…       (assets loaded relatively by game pages)
//   /hyperagent-web-apps/… passes through unchanged.
// Deploy with `npx wrangler deploy` from this directory, or paste into the dashboard editor.
// The TURN Worker's ALLOWED_ORIGINS must include https://games.sweedler.com.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    let targetPath;

    if (url.pathname === "/" || url.pathname === "") {
      // Root -> /hyperagent-web-apps/
      targetPath = "/hyperagent-web-apps/";
    } else if (url.pathname.startsWith("/hyperagent-web-apps/")) {
      // Direct asset paths pass through unchanged
      targetPath = url.pathname;
    } else if (url.pathname.startsWith("/games/")) {
      // Landing-page links (games/XXX/) -> canonical short URL /XXX/
      return Response.redirect(url.origin + url.pathname.slice("/games".length) + url.search, 301);
    } else if (url.pathname.startsWith("/shared/")) {
      // Game pages load ../../shared/… which resolves to /shared/… here
      targetPath = "/hyperagent-web-apps" + url.pathname;
    } else {
      // /XXX -> /hyperagent-web-apps/games/XXX
      targetPath = "/hyperagent-web-apps/games" + url.pathname;
    }

    const target = new URL(targetPath + url.search, "https://arisweedler-at.github.io");

    const proxyReq = new Request(target, {
      method: request.method,
      headers: request.headers,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      redirect: "manual",
    });

    const response = await fetch(proxyReq);

    const newHeaders = new Headers(response.headers);

    // Rewrite redirect Location headers back to games.sweedler.com
    const loc = newHeaders.get("Location");
    if (loc) {
      try {
        const locUrl = new URL(loc, target);
        if (locUrl.hostname === "arisweedler-at.github.io") {
          let newPath = locUrl.pathname;
          if (newPath.startsWith("/hyperagent-web-apps/games/")) {
            newPath = newPath.slice("/hyperagent-web-apps/games".length);
          } else if (newPath.startsWith("/hyperagent-web-apps/")) {
            newPath = newPath.slice("/hyperagent-web-apps".length);
          }
          if (!newPath.startsWith("/")) newPath = "/" + newPath;
          newHeaders.set("Location", url.origin + newPath + locUrl.search);
        }
      } catch {}
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
