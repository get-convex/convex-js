Tests of the contents of dist/\*, for testing things like

- TypeScript treating the same code imported from different entry points (e.g.
  convex/server-internal and convex/server)
- Bundle size
- importing built artifacts in different environments (although this is mostly
  tested outside of the convex package)
