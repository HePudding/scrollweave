export type ProjectEntry = {
  id: string;
  directory: string;
  name: string;
  createdAt: string;
  lastOpenedAt: string;
  favorite: boolean;
  modifiedAt: string;
  status: "ready" | "missing" | "invalid";
  error?: string;
  active: boolean;
  revision?: number;
  duration?: number;
  width?: number;
  height?: number;
  assetCount?: number;
  clipCount?: number;
  thumbnail?: string;
  coverText?: string;
  background?: string;
};

export type ProjectLibraryState = {
  projects: ProjectEntry[];
  defaultDirectory: string;
  activeDirectory: string;
};

export type DirectoryListing = {
  directory: string;
  parent: string | null;
  isProject: boolean;
  breadcrumbs: { name: string; directory: string }[];
  shortcuts: { name: string; directory: string }[];
  folders: { name: string; directory: string; isProject: boolean }[];
  truncated: boolean;
};
