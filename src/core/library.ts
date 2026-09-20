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
