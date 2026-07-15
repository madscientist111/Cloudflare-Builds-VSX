export interface CommitRef {
  readonly branch: string;
  readonly headSha: string;
  readonly isPushed: boolean;
  readonly subject: string;
  readonly upstreamSha: string;
}
