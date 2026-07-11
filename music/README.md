# Drop your FLAC files here

Place lossless `.flac` files in this folder and they appear in the JamSync
library automatically.

**Naming:** embedded FLAC tags (title / artist / album / album art) are read
first. If a file has no tags, JamSync falls back to the filename, so use:

```
Artist Name - Song Title.flac
```

After adding files, either restart the backend or call
`POST /api/library/rescan` (the frontend's library refresh also triggers this).
