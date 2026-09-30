import { RepoProfile } from "@/lib/types/steering";

export type ScanStage = "metadata" | "manifest" | "commits" | "config";
export type ScanOutcome = "complete" | "partial" | "cancelled" | "timed_out";
export type ScanErrorCode =
  | "invalid_ref"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "network"
  | "http_error";

export interface ScanIssue {
  stage: ScanStage;
  code: ScanErrorCode | "parse";
  status?: number;
  message: string;
}

export interface ScanResult {
  profile: RepoProfile & { incomplete?: boolean };
  outcome: ScanOutcome;
  issues: ScanIssue[];
}

export class ScanError extends Error {
  code: ScanErrorCode;
  status?: number;
  resetAt?: number;

  constructor(message: string, code: ScanErrorCode, options?: { status?: number; resetAt?: number }) {
    super(message);
    this.name = "ScanError";
    this.code = code;
    this.status = options?.status;
    this.resetAt = options?.resetAt;
    Object.setPrototypeOf(this, ScanError.prototype);
  }
}
