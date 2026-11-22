# Anime After Hours

The game is designed for desktop computers.

On Windows, double-click `Play.cmd`. It starts a local server and opens the game in your browser. Keep the server window open while playing; close it to stop the server. No installation is required.

Alternatively, serve the project directory over HTTP with any web server and open the page through it. The PowerShell server is optional. Opening `index.html` directly is not supported. An internet connection is required to download the quiz data and poster images.

The site can also be published as a static GitHub Pages site. Publish `index.html`, `app.js`, `styles.css`, and the `source/music` and `source/frames` folders; no server-side code is required. The media uses relative URLs so it works both at a user site root and at a repository project URL.

Select all matching anime and reveal the answer to score a question. The 10 available points are divided equally among all correct answers; each correct pick earns its share, and each incorrect pick deducts 3 points, down to zero. The timer starts when the clue is shown and stops when the answer is requested. For the first 5 seconds there is no time penalty; after that, the score decreases linearly to zero at 45 seconds and is rounded down to hundredths. The answer can still be revealed after time runs out. Finish the game after any answered question to see your score against the maximum for the questions answered; playing again reshuffles the questions and resets the score.

The `FULL_SCORE_TIME_MS` values in `app.js` can be adjusted separately for `music`, `description`, and `frames`. Each value is in milliseconds and must be at least zero and less than the 45-second question limit.

Edit the `V2` and `Animes` sheets in the [Google spreadsheet](https://docs.google.com/spreadsheets/d/11yaou7CKAUe7ebrMjAoYG-JCx-pWR0FT2YPAb63tXKs/edit) to change the questions and anime catalog. The browser downloads both sheets as CSV when the game opens; they may have different numbers of rows. The spreadsheet must remain accessible to anyone with the link, without signing in.

- In `V2`, `Respuesta` and `Distractores` are comma-separated anime IDs. Together they must contain no more than five distinct IDs, each present in the anime catalog. Random anime fill any remaining slots.
- In `V2`, `Tipo` is `Musica`, `Descripción`, or `Frames`; `Fuente` is the music filename without `.mp3` in `source/music`, the description text in any language, or three comma-separated frame filenames without `.jpg` in `source/frames`.
- In `V2`, `Comentario Adicional` is optional text and links displayed with the answer.
- In `Animes`, `MAL`, `Name`, and `Photo` are the anime ID, name, and image URL.

The sheet identifiers are configured in `app.js`. If either sheet is recreated, update its identifier there.
