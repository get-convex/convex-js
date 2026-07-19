#!/usr/bin/env python3

"""
Build polyfill variants of convex-js package.

Transforms standard ESM/CJS builds to use JSBI instead of native BigInt.
Creates dist/esm-polyfill/ and dist/cjs-polyfill/ directories.

Strategy:
- Copy dist/esm -> dist/esm-polyfill
- Replace bigint-ops.js with compiled bigint-ops.polyfill.js
- User bundlers tree-shake JSBI if not imported via /polyfill
"""

import shutil
from pathlib import Path


def swap_bigint_ops_implementation(dest_dir: Path, build_type: str) -> None:
    """
    Replace native bigint-ops.js with JSBI polyfill variant.

    Reads compiled .polyfill.js from standard build and swaps it in.
    """
    # Path to compiled polyfill variant in standard build
    polyfill_compiled = dest_dir.parent / build_type / "values" / "bigint-ops.polyfill.js"
    polyfill_map = dest_dir.parent / build_type / "values" / "bigint-ops.polyfill.js.map"

    # Target paths in polyfill build
    target_js = dest_dir / "values" / "bigint-ops.js"
    target_map = dest_dir / "values" / "bigint-ops.js.map"

    if polyfill_compiled.exists():
        shutil.copy2(polyfill_compiled, target_js)
        if polyfill_map.exists():
            shutil.copy2(polyfill_map, target_map)
    else:
        print(f"Warning: {polyfill_compiled} not found, polyfill may not work")




def build_polyfill_variant(build_type: str) -> None:
    """
    Build polyfill variant for given build type (esm or cjs).

    Strategy: Copy entire dist, then swap bigint-ops.js with polyfill variant.
    """
    src_dir = Path("dist") / build_type
    dest_dir = Path("dist") / f"{build_type}-polyfill"

    print(f"Building {build_type}-polyfill variant...")

    if not src_dir.exists():
        print(f"Error: {src_dir} does not exist. Run standard build first.")
        return

    # Clean destination
    if dest_dir.exists():
        shutil.rmtree(dest_dir)

    # Copy entire build
    shutil.copytree(src_dir, dest_dir)

    # Swap bigint-ops implementation
    swap_bigint_ops_implementation(dest_dir, build_type)

    print(f"OK {build_type}-polyfill built to {dest_dir}")


def build_polyfill_types(types_dir: str) -> None:
    """
    Copy type definitions to polyfill variant.
    Types are identical between native and polyfill builds.
    """
    src_dir = Path("dist") / types_dir
    dest_dir = Path("dist") / f"{types_dir}-polyfill"

    if not src_dir.exists():
        return

    print(f"Copying {types_dir} to polyfill variant...")

    if dest_dir.exists():
        shutil.rmtree(dest_dir)

    shutil.copytree(src_dir, dest_dir)

    # Preserve package.json
    if (src_dir / "package.json").exists():
        shutil.copy2(src_dir / "package.json", dest_dir / "package.json")

    print(f"OK {types_dir}-polyfill copied")


def main() -> None:
    """Build all polyfill variants."""
    print("=" * 60)
    print("Building JSBI polyfill variants")
    print("=" * 60)

    # Build JavaScript variants
    build_polyfill_variant("esm")
    build_polyfill_variant("cjs")

    # Copy type definitions
    build_polyfill_types("esm-types")
    build_polyfill_types("cjs-types")
    build_polyfill_types("internal-esm-types")
    build_polyfill_types("internal-cjs-types")

    print("=" * 60)
    print("OK All polyfill variants built successfully")
    print("=" * 60)


if __name__ == "__main__":
    main()
