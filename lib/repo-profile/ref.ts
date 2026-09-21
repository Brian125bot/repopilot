import { ScanError } from "./types";

const OWNER_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_REGEX = /^[A-Za-z0-9._-]{1,100}$/;

export interface RepoRefInput {
  owner: string;
  repo: string;
}

export interface ValidatedRepoRef {
  owner: string;
  repo: string;
  canonicalId: string;
}

export function validateAndParseRef(target: RepoRefInput): ValidatedRepoRef {
  const owner = target.owner?.trim();
  const repo = target.repo?.trim();

  if (!owner || !OWNER_REGEX.test(owner)) {
    throw new ScanError("Invalid repository owner format", "invalid_ref");
  }

  if (!repo || !REPO_REGEX.test(repo) || repo === "." || repo === "..") {
    throw new ScanError("Invalid repository name format", "invalid_ref");
  }

  const canonicalId = `${owner}/${repo}`.toLowerCase();

  return {
    owner,
    repo,
    canonicalId,
  };
}
