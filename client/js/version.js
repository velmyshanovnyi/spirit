// Section footer-1 (2026-07-31, user request): a build marker shown in the
// app footer so users/volunteers can tell which deploy they're looking at.
// No bundler/CI in this project (deploys are manual FTP), so this is a
// plain date stamp bumped by hand whenever a meaningfully new build ships --
// not meant to be commit-precise, just enough to tell two deploys apart.
export const APP_VERSION = "2026-07-31";
