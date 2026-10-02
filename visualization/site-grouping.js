// Offline PSL snapshot: assets/public_suffix_list.dat (upstream MPL-2.0).
// Include PRIVATE rules to keep unrelated hosting tenants separate.
let siteSuffixRules = null;
const siteDomainCache = new Map();
// Exact service roots and all their children can be mapped explicitly here.
// Longest root wins. Targets should be stable service domains.
const SITE_GROUP_OVERRIDES = new Map();

function parseSiteSuffixRules(text) {
  const rules = {exact:new Set(), wildcard:new Set(), exception:new Set()};
  for (const line of text.split(/\r?\n/)) {
    const rule = line.trim().split(/\s+/)[0];
    if (!rule || rule.startsWith("//")) continue;
    const kind = rule.startsWith("!") ? "exception" : rule.startsWith("*.") ? "wildcard" : "exact";
    const body = rule.replace(/^!|^\*\./, "");
    const host = new URL("https://" + body).hostname.toLowerCase();
    rules[kind].add(host);
  }
  if (!rules.exact.has("com") || !rules.exact.has("co.kr")) throw new Error("Invalid public suffix list");
  return rules;
}

async function initializeSiteGrouping() {
  const response = await fetch(chrome.runtime.getURL("visualization/assets/public_suffix_list.dat"));
  if (!response.ok) throw new Error("Public suffix list unavailable");
  siteSuffixRules = parseSiteSuffixRules(await response.text());
  siteDomainCache.clear();
}

function getSiteDomain(domain) {
  if (typeof domain !== "string") return domain;
  if (siteDomainCache.has(domain)) return siteDomainCache.get(domain);
  // This API accepts stored hostnames, not URLs or paths.
  if (!domain || /[\s/@?#]/.test(domain)) return domain;
  let host;
  try { host = new URL("https://" + domain).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return domain; }
  if (host.includes(":") || /^[\d.]+$/.test(host) || !host.includes(".")) return host;
  if (!siteSuffixRules) throw new Error("Site grouping not initialized");
  const labels = host.split(".");
  if (labels.some(label => !label)) return domain;
  let suffixLength = 1;
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join(".");
    if (siteSuffixRules.exception.has(suffix)) {
      suffixLength = labels.length - i - 1;
      break;
    }
    if (siteSuffixRules.exact.has(suffix)) suffixLength = Math.max(suffixLength, labels.length - i);
    if (i > 0 && siteSuffixRules.wildcard.has(suffix)) suffixLength = Math.max(suffixLength, labels.length - i + 1);
  }
  let result = host;
  if (labels.length > suffixLength) {
    const base = labels.slice(-(suffixLength + 1)).join(".");
    const service = labels[labels.length - suffixLength - 2];
    result = !service || service === "www" ? base : service + "." + base;
  }
  // Test boundaries rather than substrings: example.com.evil must not match.
  for (let i = 0; i < labels.length; i++) {
    const root = labels.slice(i).join(".");
    if (SITE_GROUP_OVERRIDES.has(root)) { result = SITE_GROUP_OVERRIDES.get(root); break; }
  }
  if (siteDomainCache.size >= 4096) siteDomainCache.clear();
  siteDomainCache.set(domain, result);
  return result;
}
