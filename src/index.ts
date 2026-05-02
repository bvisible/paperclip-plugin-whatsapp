// Entry point — re-exports the manifest and worker so consumers can import
// either via the package exports or via the paperclipPlugin field in package.json.
export { default as manifest } from "./manifest.js";
export { default as plugin } from "./worker.js";
