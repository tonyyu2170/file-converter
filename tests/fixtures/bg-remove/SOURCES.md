# bg-remove fixture sources

All fixtures are Unsplash photos resized to <= 1600 px on the long side and
re-encoded to JPEG quality ~70 to fit under 1 MB. Unsplash photos are licensed
under the Unsplash License (use freely, including commercial; attribution is
appreciated but not required -- we record it here as a courtesy).

Originals were retrieved through the Unsplash image CDN at `w=3000` (the
maximum width parameter Unsplash exposes on the public photo page); the
"fetched dimensions" column below records the dimensions we downloaded from
the CDN, not the photographer's RAW dimensions, which Unsplash does not
publish.

| File | Unsplash URL | Photographer | Fetched dimensions -> resized |
|---|---|---|---|
| product-on-white.jpg | https://unsplash.com/photos/l0ah3UBLppo | 五玄土 ORIENTO | 1600x1128 -> 1600x1128 |
| portrait-cluttered-bg.jpg | https://unsplash.com/photos/woman-with-long-red-hair-in-a-park-kobNMjihtsg | Osama Madlom | 1600x2000 -> 1280x1600 |
| transparent-glass.jpg | https://unsplash.com/photos/clear-wine-glass-UtByU3uhBVM | Honza Vojtek | 1600x2490 -> 1028x1600 |
