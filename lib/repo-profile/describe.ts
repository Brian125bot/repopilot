import { ScanResult, ScanError } from "./types";

export function describeScanOutcome(result: ScanResult): string {
  if (result.outcome === "complete") {
    return "Scan completed successfully.";
  }
  if (result.outcome === "cancelled") {
    return "Scan was cancelled by user.";
  }
  if (result.outcome === "timed_out") {
    return "Scan timed out before completion.";
  }

  if (result.issues.length > 0) {
    const stageSummaries = result.issues.map((issue) => {
      if (issue.code === "parse") {
        return `${issue.stage}: Invalid response format`;
      }
      if (issue.status) {
        return `${issue.stage}: HTTP ${issue.status}`;
      }
      return `${issue.stage}: ${issue.message}`;
    });
    return `Scan partially completed with issues (${stageSummaries.join("; ")})`;
  }

  return "Scan partially completed.";
}

export function describeScanError(err: unknown): string {
  if (err instanceof ScanError) {
    switch (err.code) {
      case "invalid_ref":
        return err.message || "Invalid repository owner or name format.";
      case "unauthorized":
        return "GitHub rejected this token.";
      case "forbidden":
        return "Access forbidden. Your GitHub PAT lacks permission for this repository.";
      case "not_found":
        return "Repository not found, or this token can't access it.";
      case "rate_limited": {
        if (err.resetAt) {
          const resetTimeStr = new Date(err.resetAt).toLocaleTimeString();
          return `GitHub API rate limit exceeded. Resets at ${resetTimeStr}.`;
        }
        return "GitHub API rate limit exceeded.";
      }
      case "network":
        return "Network connection error while communicating with GitHub.";
      case "http_error":
        return err.status ? `GitHub API returned error status ${err.status}.` : "GitHub API request failed.";
    }
  }

  if (err instanceof Error) {
    return err.message;
  }

  return "An unexpected error occurred during repository scan.";
}
