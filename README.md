# Anime After Hours

The game is designed for desktop computers.

On Windows, double-click `Play.cmd`. It starts a local server and opens the game in your browser, loading `source/GuestAnime - V2.csv` and `source/GuestAnime - Animes.csv` automatically. Keep the server window open while playing; close it to stop the server. No installation is required.

Alternatively, serve the project directory over HTTP with any web server and open the page through it; `app.js` fetches and parses both CSVs itself. The PowerShell server is optional. Opening `index.html` directly does not work because browsers block automatic access to local files. Poster images and the optional links require an internet connection.

The site can also be published as a static GitHub Pages site. Publish the project directory with `index.html`, `app.js`, `styles.css`, and the complete `source` folder; no server-side code is required. The quiz uses relative URLs so it works both at a user site root and at a repository project URL.

Select all matching anime and reveal the answer to score a question. The 10 available points are divided equally among all correct answers; each correct pick earns its share, and each incorrect pick deducts 3 points, down to zero. The timer starts when the clue is shown and stops when the answer is requested. For the first 5 seconds there is no time penalty; after that, the score decreases linearly to zero at 45 seconds and is rounded down to hundredths. The answer can still be revealed after time runs out. Finish the game after any answered question to see your score against the maximum for the questions answered; playing again reshuffles the questions and resets the score.

The `FULL_SCORE_TIME_MS` values in `app.js` can be adjusted separately for `music`, `description`, and `frames`. Each value is in milliseconds and must be at least zero and less than the 45-second question limit.

Edit `source/GuestAnime - V2.csv` to change the questions and `source/GuestAnime - Animes.csv` to change the anime catalog. They may have different numbers of rows.

- In the questions CSV, `Respuesta` and `Distractores` are comma-separated anime IDs. Together they must contain no more than five distinct IDs, each present in the anime catalog. Random anime fill any remaining slots.
- In the questions CSV, `Tipo` is `Musica`, `Descripción`, or `Frames`; `Fuente` is the music filename without `.mp3` in `source/music`, the description text in any language, or three comma-separated frame filenames without `.jpg` in `source/frames`.
- In the questions CSV, `Comentario Adicional` is optional text and links displayed with the answer.
- In the anime catalog, `MAL`, `Name`, and `Photo` are the anime ID, name, and image URL.

Quote CSV fields containing commas, line breaks, or quotation marks; escape a quotation mark inside a quoted field by doubling it.
