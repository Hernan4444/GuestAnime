# Anime After Hours

The game is designed for desktop computers.

On Windows, double-click `Play.cmd`. It starts a local server and opens the game in your browser, loading `source/GuestAnime.csv` automatically. Keep the server window open while playing; close it to stop the server. No installation is required.

Alternatively, serve the project directory over HTTP with any web server and open the page through it; `app.js` fetches and parses the CSV itself. The PowerShell server is optional. Opening `index.html` directly does not work because browsers block automatic access to local files. Poster images and the optional links require an internet connection.

Select all matching anime and reveal the answer to score a question. The 10 available points are divided equally among all correct answers; each correct pick earns its share, and each incorrect pick deducts 3 points, down to zero. The timer starts when the clue is shown and stops when the answer is requested. For the first 5 seconds there is no time penalty; after that, the score decreases linearly to zero at 45 seconds and is rounded down to hundredths. The answer can still be revealed after time runs out. Finish the game after any answered question to see your score against the maximum for the questions answered; playing again reshuffles the questions and resets the score.

The `FULL_SCORE_TIME_MS` values in `app.js` can be adjusted separately for `music`, `description`, and `frames`. Each value is in milliseconds and must be at least zero and less than the 45-second question limit.

Edit `source/GuestAnime.csv` to change the quiz. The file contains both the questions and the anime catalog; they may have different numbers of rows.

- `Respuesta` and `Distractores`: comma-separated anime IDs. Together they must contain no more than five distinct IDs, each present in the `MAL` column. Random anime fill any remaining slots.
- `Tipo`: `Musica`, `Descripción`, or `Frames`.
- `Fuente`: the music filename without `.mp3` in `source/music`, the description text in any language, or three comma-separated frame filenames without `.jpg` in `source/frames`.
- `Comentario Adicional`: optional text and links displayed with the answer.
- `MAL`, `Name`, and `Photo`: the anime ID, name, and image URL.

Quote CSV fields containing commas, line breaks, or quotation marks; escape a quotation mark inside a quoted field by doubling it.
