/**
 * GitHub `Link` headers are attacker-influenced input: whatever host the response
 * came from, the header itself is just a string. Following a `rel="next"` URL
 * blindly would resend the operator's `Authorization: Bearer <PAT>` header to
 * whatever host the header names, so pagination is restricted to the canonical
 * GitHub API origin.
 */
export const GITHUB_API_ORIGIN = "https://api.github.com";

export function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const links: Record<string, string> = {};
  for (const part of header.split(",")) {
    const section = part.split(";");
    if (section.length !== 2) continue;
    const url = section[0].trim().replace(/^</, "").replace(/>$/, "");
    const name = section[1].trim().replace(/^rel="(.*)"$/, "$1");
    if (!url || !name) continue;
    links[name] = url;
  }
  return links;
}

/** True only for absolute https URLs on the canonical GitHub API origin. */
export function isTrustedGitHubUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.origin === GITHUB_API_ORIGIN;
}

/**
 * Returns the `rel="next"` URL when it is safe to follow, otherwise null so the
 * caller stops paginating instead of leaking the PAT to an untrusted host.
 */
export function trustedNextPageUrl(linkHeader: string | null): string | null {
  const next = parseLinkHeader(linkHeader).next;
  return isTrustedGitHubUrl(next) ? next! : null;
}
