ghdc-vuln
===
GitHub Date Colelction - Vulnerable Source code


## Data Storage Directory Structure

* data/
  * `<task_name>`
    * commits/
      * `<user>__<repo>__<commit-sha>.json`
    * sources/
      * `<user>`/
        * `<repo>`/
          * `<commit-sha>`/
            * directory structure, as is in the git tree

## Commit JSON structure
TO BE DETERMINED

## Docker Usage
```
docker run -v <local_dir>:/root/data ghdc-vuln -t <TOKEN> 'query keywords'
```

## Caution
ghdc-{ clang-blind-ast, export-commits } incurs heavy disk write activity on `/tmp` directory. For each commit, the entire git repository will be cloned to `/tmp` (about 1G for Linux kernel). Thus it is highly recommended to setup ramdisk or `memfs` to protect host SSD.

For docker usage (recommended):
* `mount -t tmpfs -o size=12G tmpfs /tmp/ramdisk`; Adjust size accordingly. 12G is fine for running 8 parallel extractions on Linux kernel.
* run Docker image with `-v /tmp/ramdisk:/tmp`

For non-Docker usage (Assuming an standalone server environment):
* `mount -t tmpfs -o size=12G tmpfs /tmp/`; This will cause everything currently in `/tmp` to be inaccessible.
* run program normally
