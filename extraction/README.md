Extraction Function
===
Source code function body extractor modules.

Each module exports two functions (can be asynchronous):

### `extractFunctionPatchHeadings(diffStr) -> [heading, ...]`

`diffStr` is the diff string (as provided by GitHub's commit API

`heading` is a description of the function to be extracted. it will be used by extractFunction, and for display purpose.
Usually, `heading` is the function signature. In C language, in the form of `ret fn_name(args)`; There is no fixed format.

In the returned list, there should be one heading for each function that is to be extracted.

From my observation, GitHub's diff algorithm already does a good job at finding the start line of function decleration.
No need to do extra stuff for C/C++ diff. If GitHub fails to produce a reasonable header, return the **range information**
enclosed in first two `@@` block is acceptable. (As long as the `extractFunctionFromHeaders` function can find the lines
that changes in both the original commit and the patched commit.

See [Diff - Unified format]https://en.wikipedia.org/wiki/Diff#Unified_format for diff's format.

### `extractFunctionFromHeaders(fileBuf1, fileBuf2, headings) -> [Pair, ...]`

`fileBuf1` is file content before patch
`fileBuf2` is file content after patch

`headings` is the list of headings, as is extracted by `extractFunctionFromHeaders`, of this file

Function returns an array of Pair object, each pair object has the following format:

* `name`: the function's name (or unique descriptor), should only contain filename friendly character
* `before`: the function's body, before patch
* `after`: the function's body, after patch

---

Each module should be registered in `index.js`, the export name is the lowercased file extension name. During extraction, the
program will pick the appropriate module based on source code file's extension name.
