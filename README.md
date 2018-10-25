ghdc-vuln
===
GitHub Date Colelction - Vulnerable Source Code


## Data Storage Directory Structure

* `<task_name>`
  * commits/
    * `<user>__<repo>__<commit-sha>.json`
  * sources/
    * `<user>`/
      * `<repo>`/
        * `<commit-sha>`/
          * directory structure, as is in the git tree

## Commit JSON structure
```JavaScript
{
  commit: ...,  // GitHub's commit response: https://developer.github.com/v3/repos/commits/#get-a-single-commit
  repo: ...,    // GitHub's repository response: https://developer.github.com/v3/repos/#get
}
```

## Non-docker usage

1. Install [node.js](https://nodejs.org/) >= 10
2. Install latest [yarnpkg](https://yarnpkg.com/)
3. In terminal, in this directory, run `yarn`
4. In terminal, in this directory, run `bin/ghdc-vuln -t <TOKEN> 'query keywords'`

## Docker Usage

```shell
# first build the container
docker build . -t ghdc-vuln
# run collection process in background, use -v to mount local filesystem
docker run -d -v <local_dir>:/root/data ghdc-vuln -t <TOKEN> 'query keywords'
```

You might want to have a look at [Docker run](https://docs.docker.com/engine/reference/run/) reference to execute other pipeline stages.

## Function-level Workflow / Pipeline Example

You can use `-h` command line to print usage for each tools.

#### Collect GitHub Data / ghdc-vuln
It's recommended to get a GitHub token first, which lift up rate limit to 5000/hour. See: https://blog.github.com/2013-05-16-personal-api-tokens/

```shell
bin/ghdc-vuln -O /data -n 'sql-1' -t <github-token> 'fix sql injection'
```

This will collect query `fix sql injection` to `sql-1` directory in `/data`.

The collected data will follow [Data Storage Directory Structure](#data-storage-directory-structure)

* Use `-b` switch to enable commit hash deduplication (recommended).
* Use `-z` switch to enable compression;
* Use `-d <date-range>` option to set collection date range. Format: `YYYY-MM..YYYY-MM`, or `-AyBm` (last A years and B months)


#### Inspect and Playground / ghdc-data-inspect

```shell
bin/ghdc-data-inspect /data/sql-1
```

This will start data inspector / playground on port 8091. Use browser to visit: http://localhost:8091/

You should see two input areas on top. These are for filtering and sorting the collected commits, and accepts JavaScript code fragments.

Filter function should return a boolean-like value to indicate whether a commit is included in the result.

Sort function should return `1`, `0`, `-1` to indicate the ordering of commits.

For example, to get commits from PHP language repository, and sort them in ascending order of author date, use:

* Filter: `return commit.language === 'PHP`
* Sort: `return a.time - b.time`

You can use `random()` function to sample records. For example, use filter function `return random() < 0.1` to sample 10% records.
This can be combined with other conditions.

All standard JavaScript operator and builtin functions are supported in the above input areas.

Click links in the repo column to open GitHub's commit viewing page for easy commit inspection.


#### Extract Function-level Dataset / ghdc-export-commit

```shell
bin/ghdc-export-commit /data/sql-1 /output/sql-sources
```

This will start extracting function-level source codes from commits in `/data/sql-1`, into `/output/sql-sources`.

You can use `-b` option to enable file level deduplication.

You may also want to modify `export-commit.js`'s `hasInterestingFiles` and `LARGE_DIFF_LIMIT` to control commit filtering.

Currently, function-level extraction is well supported for .c files. For .php files, the default is to extract with 30 lines of context window because php is not function scoped.

Feel free to implement additional extraction scripts, and register them in `extraction/index.js`.


## Caution
ghdc-clang-blind-ast incurs heavy disk write activity on `/tmp` directory. For each commit, the entire git repository will be cloned to `/tmp` (about 1G for Linux kernel). Thus it is highly recommended to setup ramdisk or `memfs` to protect host SSD.

For docker usage (recommended):
* `mount -t tmpfs -o size=12G tmpfs /tmp/ramdisk`; Adjust size accordingly. 12G is fine for running 8 parallel extractions on Linux kernel.
* run Docker image with `-v /tmp/ramdisk:/tmp`

For non-Docker usage (Assuming an standalone server environment):
* `mount -t tmpfs -o size=12G tmpfs /tmp/`; This will cause everything currently in `/tmp` to be inaccessible.
* run program normally


## For Developers: Directory Structure
* `bin/`: executables (command line wrappers)
* `extraction/`: source code extraction modules
* `inspector/`: Web UI resources for data inspector
* `lib/`: helper functions
* `test/`: unit tests
* `blind-ast.js`: clang AST generator implementation
* `export-commit.js`: source code extractor implementation
* `inspector.js`: source code inspector / playground implementation
* `gh-collect.js`: GitHub data collector implementation
* `profile.js`: commit profiler implementation
* `Dockerfile`: Docker container specification
* `package.json`, `yarn.lock`: library dependency specification