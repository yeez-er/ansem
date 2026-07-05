import { pgEnum } from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["x", "tiktok", "instagram"]);

export const postStatusEnum = pgEnum("post_status", [
  "pending",
  "approved",
  "rejected",
  "removed", // removed = deleted/unavailable at source
]);

export const postSourceEnum = pgEnum("post_source", [
  "submission",
  "x_search",
  "admin",
]);
