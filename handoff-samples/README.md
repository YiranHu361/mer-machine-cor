# Hand-off samples

One file of each kind our end hands to the producer side, made by `fabyn-producer` with the same settings the orchestrator uses. Each file has a `.preview.png` beside it: what the requester approves. For stickers and the 3D tag the preview is the file itself or its picture; a wide photo's preview is turned back upright.

| File | Machine | Size | What to know |
| --- | --- | --- | --- |
| `sticker-48mm-claude-cat.png` | Phomemo M02 Pro | 48 × 35 mm, 1-bit, 300 dpi (567 px wide) | A Claude drawing, trimmed; the label length follows the design. Print as is |
| `sticker-25mm-claude-cat.png` | Phomemo M02 Pro | 25 × 19 mm | The same drawing on the 25 mm width |
| `sticker-48mm-photo.png` | Phomemo M02 Pro | 48 × 52 mm | A photo, white border trimmed, dithered |
| `instax-wide-photo.png` | Instax mini Link 3 | 600 × 800 px RGB | A landscape photo turned a quarter (`rotated_degrees: 90`) to use the film's long side |
| `instax-claude-cat.png` | Instax mini Link 3 | 600 × 800 px RGB | A drawing fitted whole (`crop: contain`), not turned |
| `keychain-for-you.3mf` | Bambu Lab A1 mini | 70 × 18 × 3.6 mm, about 3.9 g PLA | Unsliced (`slicing: receiver`): the producer side slices it for the printer |

Each job carries the file's SHA-256 in `params.sha256`; please print only a download that matches it. The hand-off contract and open problems are in the design doc's Producer hand-off tab.
