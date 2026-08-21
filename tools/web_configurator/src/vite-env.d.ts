// Ambient global injected by vite.config.ts's `define` - see that file's own
// comment. Ordinary env vars would normally go through import.meta.env, but
// this needs to be a compile-time-replaced literal (baked into the built
// output, not read at runtime), which is what `define` does.
declare const __APP_BUILD_DATE__: string;
