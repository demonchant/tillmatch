const baseUrl = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
if (!new Set(["http:", "https:"]).has(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
  throw new Error("Pass an HTTP(S) base URL without embedded credentials.");
}

const checks = [
  { path: "/", title: "Tillmatch - close the payout loop", marker: "Know what" },
  { path: "/landing", title: "Tillmatch - close the payout loop", marker: "Know what" },
  { path: "/dashboard", title: "Tillmatch dashboard - Payout closeout", sessionRequired: true },
  { path: "/chat" },
];

let failed = false;
for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await response.text();
    const title = html.match(/<title>(.*?)<\/title>/i)?.[1] ?? "(no title)";
    const content = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#x27;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ");
    const markerFound = check.marker ? content.includes(check.marker) : null;
    const titleMatches = check.title ? title === check.title : null;
    const passed = response.status === 200 && markerFound !== false && titleMatches !== false;
    failed ||= !passed;
    console.log(JSON.stringify({ path: check.path, status: response.status, title, titleMatches, markerFound, sessionRequired: check.sessionRequired ?? false, preview: response.status === 200 ? undefined : content.slice(0, 900), passed }));
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ path: check.path, error: error instanceof Error ? error.message : String(error), passed: false }));
  }
}

if (failed) process.exitCode = 1;
