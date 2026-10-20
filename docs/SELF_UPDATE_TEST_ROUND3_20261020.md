# Windows Self-Update Isolated Test — Round 3

This documentation-only commit is an upgrade target for the isolated Windows Board test.

Baseline: `a91872f8c4b8b2d2808ecb85901df79f425da68b`.

The update exercises the fix that backs up SQLite with a short-lived process and avoids replacing native dependencies in the live checkout. Test only against the separate test installation and ports 8876/8877. It does not change application behavior.
