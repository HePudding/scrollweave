import type { Asset } from "./model";
export const assetURL = (a: Asset) =>
  a.deliveryPath ??
  a.data ??
  (a.cachePath
    ? "/media/" + a.cachePath.split("/").map(encodeURIComponent).join("/")
    : "");
export const thumbnailURL = (a: Asset) =>
  a.thumbnail
    ? "/media/" + a.thumbnail.split("/").map(encodeURIComponent).join("/")
    : assetURL(a);
