import type { PipelineDef } from './types';

export const PACKAGE_TOPIC = 'gst-graph-package';
export const PACKAGE_MANIFEST_FILE = 'gst-package.json';
export const PACKAGE_INDEX_FILE = 'gst-index.json';

export interface PackageElementRequirement {
  name: string;
  rationale?: string;
}

export interface PackagePipelineRef {
  file: string;
  name?: string;
}

export interface PackageVariableDefault {
  varName: string;
  label?: string;
  description?: string;
  default?: string | number | boolean | null;
  secret?: boolean;
}

export interface PackageAuthor {
  name?: string;
  url?: string;
}

export interface PackageManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  summary?: string;
  description?: string;
  author?: PackageAuthor;
  tags?: string[];
  license?: string;
  preview?: string;
  requires?: {
    gstreamer?: string;
    elements?: PackageElementRequirement[];
  };
  optional?: {
    elements?: PackageElementRequirement[];
  };
  pipelines: PackagePipelineRef[];
  variables?: PackageVariableDefault[];
}

export interface PackageRepoIndex {
  schemaVersion: 1;
  packages: Array<{ id: string; path: string }>;
}

export interface FeaturedEntry {
  repo: string;
  packageId?: string;
  highlight?: string;
}

export interface FeaturedIndex {
  schemaVersion: 1;
  featured: FeaturedEntry[];
}

export interface InstalledPackage {
  key: string;
  repo: string;
  packageId: string;
  version: string;
  sha: string;
  pipelineIds: string[];
  installedAt: number;
}

export interface InstalledPackagesFile {
  schemaVersion: 1;
  installed: InstalledPackage[];
}

export type CompatibilityIssueKind =
  | 'missing_element'
  | 'missing_optional_element'
  | 'gstreamer_version';

export interface CompatibilityIssue {
  kind: CompatibilityIssueKind;
  name: string;
  detail?: string;
}

export interface CompatibilityReport {
  compatible: boolean;
  missingRequired: CompatibilityIssue[];
  missingOptional: CompatibilityIssue[];
  gstreamerOk: boolean;
  gstreamerNote?: string;
}

export interface ResolvedPackage {
  repo: string;
  ref: string;
  sha?: string;
  manifest: PackageManifest;
  pipelines: PipelineDef[];
}

export interface MarketplacePackageCard {
  repo: string;
  packageId: string;
  manifest: PackageManifest;
  repoStars: number;
  repoDescription?: string;
  defaultBranch: string;
  pushedAt: string;
  sha: string;
  featured?: string;
  compatibility: CompatibilityReport;
}

export interface MarketplaceRateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: number;
}

export interface MarketplaceAuthState {
  authenticated: boolean;
  source?: 'gh';
}

export interface MarketplaceSearchResult {
  cards: MarketplacePackageCard[];
  warnings: string[];
  rateLimit?: MarketplaceRateLimitInfo;
  auth?: MarketplaceAuthState;
  fetchedAt: number;
  cached: boolean;
}

export interface MarketplaceInstallTarget {
  repo: string;
  packageId: string;
  sha: string;
  defaultBranch: string;
}

export interface MarketplaceInstallPipelinePreview {
  name: string;
  elementCount: number;
  variableCount: number;
  transformCount: number;
  uniqueElements: string[];
  suspiciousElements: string[];
}

export interface MarketplaceInstallAppliedDefault {
  pipelineName: string;
  varName: string;
  value: string | number | boolean | null;
}

export interface MarketplaceInstallPreview {
  ok: true;
  manifest: PackageManifest;
  repo: string;
  packageId: string;
  sha: string;
  pipelines: MarketplaceInstallPipelinePreview[];
  appliedDefaults: MarketplaceInstallAppliedDefault[];
  skippedSecretDefaults: string[];
  compatibility: CompatibilityReport;
  alreadyInstalled?: InstalledPackage;
}

export interface MarketplaceInstallPreviewError {
  ok: false;
  error: string;
}

export interface MarketplaceInstallResult {
  ok: boolean;
  error?: string;
  installed?: InstalledPackage;
  addedPipelineNames?: string[];
}
