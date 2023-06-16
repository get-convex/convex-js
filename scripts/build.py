#!/usr/bin/env python3

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

NPM = "npm.CMD" if os.name == "nt" else "npm"


def build_types() -> None:
    subprocess.run([NPM, "run", "build-types"], check=True)


def build_esm() -> None:
    subprocess.run([NPM, "run", "build-esm"], check=True)


def build_cjs() -> None:
    subprocess.run([NPM, "run", "build-cjs"], check=True)


def build_api_extractor(pkg) -> None:
    subprocess.run(
        [
            NPM,
            "run",
            "build-api",
            "--",
            f"api-extractor-configs/{pkg}-api-extractor.json",
            "--verbose",
        ],
        check=True,
    )


def build_browser_script_tag() -> None:
    subprocess.run([NPM, "run", "build-browser-script-tag"], check=True)


def build_react_script_tag() -> None:
    subprocess.run([NPM, "run", "build-react-script-tag"], check=True)


def build_standalone_cli() -> None:
    subprocess.run([NPM, "run", "build-standalone-cli"], check=True)


def main() -> None:
    pool = ThreadPoolExecutor(max_workers=8)

    children = []
    e1 = pool.submit(build_types)
    children.append(pool.submit(build_cjs))
    children.append(pool.submit(build_esm))
    children.append(pool.submit(build_browser_script_tag))
    children.append(pool.submit(build_react_script_tag))
    children.append(pool.submit(build_standalone_cli))

    # The api extractor tasks depend on `build_types`
    try:
        e1.result()
    except subprocess.CalledProcessError:
        # Skip the stacktrace - not really useful in output
        sys.exit(1)

    for pkg in [
        "browser",
        "server",
        "react",
        "values",
        "react-auth0",
        "react-clerk",
    ]:
        # There's some concurrency bug with api-extractor!
        # It shouldn't be run multiple times at once because it may use the wrong
        # config file, see [1].
        #
        # We haven't seen it in a while, maybe it's fixed.
        # If this bug comes back we'll go back to running these in series.
        if os.getenv("NO_CONCURRENT_CONVEX_NPM_BUILD"):
            build_api_extractor(pkg)
        else:
            children.append(pool.submit(build_api_extractor, pkg))

    for child in as_completed(children):
        try:
            child.result()
        except subprocess.CalledProcessError:
            # Skip the stacktrace - not really useful in output
            sys.exit(1)


if __name__ == "__main__":
    main()


# [1] this bug in api-extractor can be observed with this setup:
"""
$ npx api-extractor run -c server-api-extractor.json --verbose & npx api-extractor run -c react-api-extractor.json --verbose
[1] 60546

api-extractor 7.28.3  - https://api-extractor.com/


api-extractor 7.28.3  - https://api-extractor.com/

Analysis will use the bundled TypeScript version 4.6.4
Analysis will use the bundled TypeScript version 4.6.4
The API report is up to date: temp/server-tmp.api.md
Writing package typings: /Users/tomb/convex/npm-packages/convex/dist/esm/server/server.d.ts
The API report is up to date: temp/server-tmp.api.md
Writing package typings: /Users/tomb/convex/npm-packages/convex/dist/esm/server/server.d.ts
Writing package typings: /Users/tomb/convex/npm-packages/convex/dist/esm/server/server-internal.d.ts
Writing package typings: /Users/tomb/convex/npm-packages/convex/dist/esm/server/server-internal.d.ts

API Extractor completed successfully

API Extractor completed successfully
[1]  + done       npx api-extractor run -c server-api-extractor.json --verbose
"""
