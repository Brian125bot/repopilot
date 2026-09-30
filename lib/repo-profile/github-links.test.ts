// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  parseLinkHeader,
  isTrustedGitHubUrl,
  trustedNextPageUrl,
  GITHUB_API_ORIGIN,
} from "./github-links";

describe("parseLinkHeader", () => {
  it("parses a multi-relation Link header", () => {
    const header =
      '<https://api.github.com/user/repos?page=2>; rel="next", ' +
      '<https://api.github.com/user/repos?page=9>; rel="last"';

    const links = parseLinkHeader(header);
    expect(links.next).toBe("https://api.github.com/user/repos?page=2");
    expect(links.last).toBe("https://api.github.com/user/repos?page=9");
  });

  it("returns an empty map for a missing or malformed header", () => {
    expect(parseLinkHeader(null)).toEqual({});
    expect(parseLinkHeader("")).toEqual({});
    expect(parseLinkHeader("not-a-link-header")).toEqual({});
  });
});

describe("isTrustedGitHubUrl", () => {
  it("accepts absolute https URLs on the GitHub API origin", () => {
    expect(isTrustedGitHubUrl(`${GITHUB_API_ORIGIN}/user/repos?page=2`)).toBe(true);
  });

  it("rejects foreign hosts that would receive the Authorization header", () => {
    const hostile = [
      "https://evil.example.com/user/repos?page=2",
      "https://api.github.com.evil.test/user/repos",
      "https://user:pass@evil.test/user/repos",
      "http://api.github.com/user/repos",
      "//api.github.com/user/repos",
      "/user/repos?page=2",
      "javascript:alert(1)",
      "",
      null,
      undefined,
    ];

    for (const url of hostile) {
      expect(isTrustedGitHubUrl(url)).toBe(false);
    }
  });
});

describe("trustedNextPageUrl", () => {
  it("follows a next URL that stays on the GitHub API origin", () => {
    const header = `<https://api.github.com/user/repos?page=2&per_page=100>; rel="next"`;
    expect(trustedNextPageUrl(header)).toBe(
      "https://api.github.com/user/repos?page=2&per_page=100"
    );
  });

  it("refuses to follow a next URL pointed at another origin", () => {
    const header = '<https://evil.example.com/steal?page=2>; rel="next"';
    expect(trustedNextPageUrl(header)).toBeNull();
  });

  it("refuses a next URL that downgrades to http on the API host", () => {
    const header = '<http://api.github.com/user/repos?page=2>; rel="next"';
    expect(trustedNextPageUrl(header)).toBeNull();
  });

  it("returns null when there is no next relation", () => {
    expect(trustedNextPageUrl('<https://api.github.com/user/repos?page=1>; rel="prev"')).toBeNull();
    expect(trustedNextPageUrl(null)).toBeNull();
  });
});
