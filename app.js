"use strict";

const FRAME_DURATION_MS = 6000;
const MAX_QUESTION_POINTS = 10;
const MISTAKE_PENALTY = 3;
const FULL_SCORE_TIME_MS = {
  music: 5000,
  description: 10000,
  frames: 7000
};
const QUESTION_TIME_LIMIT_MS = 45000;

const grid = document.getElementById("anime-grid");
const roundLabel = document.getElementById("round-label");
const modeLabel = document.getElementById("mode-label");
const clueTitle = document.getElementById("clue-title");
const clueHint = document.getElementById("clue-hint");
const clueContent = document.getElementById("clue-content");
const notes = document.getElementById("answer-notes");
const errorMessage = document.getElementById("error-message");
const actionButton = document.getElementById("action-button");
const finishButton = document.getElementById("finish-button");
const scoreLabel = document.getElementById("score-label");
const questionScore = document.getElementById("question-score");
const questionTimer = document.getElementById("question-timer");
const instructionsDialog = document.getElementById("instructions-dialog");
const resultsDialog = document.getElementById("results-dialog");
const resultsScore = document.getElementById("results-score");
const resultsDetail = document.getElementById("results-detail");

let ANIME = {};
let QUESTIONS = [];
let questionIndex = 0;
let stage = "ready";
let frameTimer = null;
let countdownTimer = null;
let currentAudio = null;
let questionStartedAt = null;
let totalScoreHundredths = 0;
let answeredQuestions = 0;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
        afterQuote = true;
      } else {
        field += char;
      }
    } else if (char === '"' && !field && !afterQuote) {
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(field);
      field = "";
      afterQuote = false;
      if (char !== ",") {
        rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      if (afterQuote || char === '"') throw new Error("The CSV contains an invalid quoted field.");
      field += char;
    }
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  if (field || row.length || afterQuote) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function loadData(questionText, animeText) {
  const questionRows = parseCsv(questionText);
  const questionHeaders = questionRows.shift();
  const questionColumns = ["Respuesta", "Distractores", "Tipo", "Fuente", "Comentario Adicional"];
  const animeRows = parseCsv(animeText);
  const animeHeaders = animeRows.shift();
  const animeColumns = ["MAL", "Name", "Photo"];
  if (!questionHeaders || questionColumns.some(name => !questionHeaders.includes(name)) ||
      !animeHeaders || animeColumns.some(name => !animeHeaders.includes(name))) {
    throw new Error("A CSV is missing required columns.");
  }
  const questionColumn = Object.fromEntries(questionColumns.map(name => [name, questionHeaders.indexOf(name)]));
  const animeColumn = Object.fromEntries(animeColumns.map(name => [name, animeHeaders.indexOf(name)]));
  const anime = {};
  const questions = [];
  const splitIds = value => value.split(",").map(item => item.trim()).filter(Boolean);
  const types = { musica: "music", descripcion: "description", frames: "frames" };
  animeRows.forEach((row, index) => {
    const get = name => (row[animeColumn[name]] || "").trim();
    const id = get("MAL");
    if (!id || !get("Name") || !get("Photo") || anime[id]) {
      throw new Error(`Anime CSV row ${index + 2} has an incomplete or duplicate anime.`);
    }
    anime[id] = { name: get("Name"), image: get("Photo") };
  });
  questionRows.forEach(row => {
    const get = name => (row[questionColumn[name]] || "").trim();
    if (get("Respuesta") || get("Distractores") || get("Tipo") || get("Fuente") || get("Comentario Adicional")) {
      const type = types[get("Tipo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()];
      questions.push({
        type,
        answers: splitIds(get("Respuesta")),
        distractors: splitIds(get("Distractores")),
        source: type === "frames" ? splitIds(get("Fuente")) : get("Fuente"),
        comment: get("Comentario Adicional")
      });
    }
  });
  ANIME = anime;
  QUESTIONS = questions;
  validateData();
  questionIndex = 0;
  showQuestion();
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function validateData() {
  if (Object.values(FULL_SCORE_TIME_MS).some(time => !Number.isFinite(time) || time < 0 || time >= QUESTION_TIME_LIMIT_MS)) {
    throw new Error("Full-score times must be non-negative and shorter than the question time limit.");
  }
  if (!QUESTIONS.length) throw new Error("There are no questions to play.");
  for (const [index, question] of QUESTIONS.entries()) {
    const choices = [...question.answers, ...question.distractors];
    if (!question.answers.length || new Set(choices).size !== choices.length || choices.length > 5 ||
        choices.some(id => !ANIME[id]) || Object.keys(ANIME).length < 5) {
      throw new Error(`Question ${index + 1} has invalid answers or anime IDs.`);
    }
    if (!["music", "description", "frames"].includes(question.type) ||
        (question.type === "frames" ? !Array.isArray(question.source) || question.source.length !== 3 : typeof question.source !== "string" || !question.source.trim())) {
      throw new Error(`Question ${index + 1} has an invalid clue.`);
    }
  }
}

function stopClue() {
  clearInterval(frameTimer);
  frameTimer = null;
  clearInterval(countdownTimer);
  countdownTimer = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function setButton(label, symbol) {
  actionButton.replaceChildren(document.createTextNode(label + " "));
  const arrow = document.createElement("span");
  arrow.textContent = symbol;
  actionButton.append(arrow);
}

function showQuestion() {
  stopClue();
  stage = "ready";
  questionStartedAt = null;
  const question = QUESTIONS[questionIndex];
  const choices = [...question.answers, ...question.distractors];
  const fillers = shuffle(Object.keys(ANIME).filter(id => !choices.includes(id)));
  const options = shuffle([...choices, ...fillers.slice(0, 5 - choices.length)]);

  roundLabel.textContent = `QUESTION ${String(questionIndex + 1).padStart(2, "0")} / ${String(QUESTIONS.length).padStart(2, "0")}`;
  
  modeLabel.textContent = { music: "MUSIC ROUND", description: "DESCRIPTION ROUND", frames: "FRAMES ROUND" }[question.type];
  grid.replaceChildren();
  options.forEach(id => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "anime-card";
    card.dataset.id = id;
    card.setAttribute("aria-pressed", "false");
    card.addEventListener("click", () => {
      const selected = card.getAttribute("aria-pressed") !== "true";
      card.setAttribute("aria-pressed", String(selected));
      card.classList.toggle("selected", selected);
    });
    const imageWrap = document.createElement("span");
    imageWrap.className = "poster-wrap";
    const image = document.createElement("img");
    image.src = ANIME[id].image;
    image.alt = "";
    image.addEventListener("error", () => {
      image.hidden = true;
      imageWrap.classList.add("image-unavailable");
    });
    const selection = document.createElement("span");
    selection.className = "selection-label";
    selection.textContent = "✓ YOUR PICK";
    imageWrap.append(image, selection);
    const name = document.createElement("span");
    name.className = "anime-name";
    name.textContent = ANIME[id].name;
    card.append(imageWrap, name);
    grid.append(card);
  });
  clueTitle.textContent = "Ready when you are.";
  clueHint.textContent = "Start the quiz to reveal your clue.";
  clueContent.innerHTML = '<div class="clue-placeholder" aria-hidden="true"><span>✳</span> YOUR CLUE AWAITS</div>';
  notes.replaceChildren();
  notes.hidden = true;
  errorMessage.hidden = true;
  questionScore.hidden = true;
  questionTimer.hidden = true;
  finishButton.hidden = true;
  setButton("Start quiz", "↗");
  actionButton.hidden = false;
  actionButton.disabled = false;
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function startQuestion() {
  const question = QUESTIONS[questionIndex];
  stage = "started";
  clueContent.replaceChildren();
  if (question.type === "music") {
    clueTitle.textContent = "Listen closely.";
    clueHint.textContent = "Play, pause, or seek. The anime may use a different version or cover.";
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = `source/music/${encodeURIComponent(question.source)}.mp3`;
    audio.addEventListener("error", () => showError("The audio could not be loaded. Check that the music file is available."));
    clueContent.append(audio);
    currentAudio = audio;
    audio.play().catch(() => {
      if (!audio.error) showError("Playback could not start automatically. Press play on the audio player.");
    });
  } else if (question.type === "description") {
    clueTitle.textContent = "Read between the lines.";
    clueHint.textContent = "Which story does this sound like?";
    const quote = document.createElement("blockquote");
    quote.textContent = question.source;
    clueContent.append(quote);
  } else {
    clueTitle.textContent = "Watch the frames.";
    clueHint.textContent = `A new frame appears every ${FRAME_DURATION_MS / 1000} seconds.`;
    const frameBox = document.createElement("div");
    frameBox.className = "frame-box";
    const image = document.createElement("img");
    image.alt = "Anime clue, frame 1 of 3";
    image.addEventListener("error", () => showError("The frame could not be loaded. Check that the image file is available."));
    const frameLabel = document.createElement("span");
    frameLabel.className = "frame-label";
    const timer = document.createElement("div");
    timer.className = "frame-timer";
    const timerValue = document.createElement("span");
    timerValue.className = "timer-value";
    timer.append(timerValue);
    frameBox.append(image, frameLabel, timer);
    clueContent.append(frameBox);
    const startedAt = performance.now();
    let displayedFrame = -1;
    function updateFrame() {
      const elapsed = Math.max(0, performance.now() - startedAt);
      const frame = Math.min(2, Math.floor(elapsed / FRAME_DURATION_MS));
      if (frame !== displayedFrame) {
        displayedFrame = frame;
        image.src = `source/frames/${encodeURIComponent(question.source[frame])}.jpg`;
        image.alt = `Anime clue, frame ${frame + 1} of 3`;
        frameLabel.textContent = `FRAME 0${frame + 1} / 03`;
      }
      if (frame === 2) {
        timer.hidden = true;
        clearInterval(frameTimer);
        frameTimer = null;
      } else {
        const remaining = FRAME_DURATION_MS - (elapsed % FRAME_DURATION_MS);
        timer.style.setProperty("--remaining", `${remaining / FRAME_DURATION_MS * 100}%`);
        timerValue.textContent = Math.ceil(remaining / 1000);
        timer.setAttribute("aria-label", `${Math.ceil(remaining / 1000)} seconds until the next frame`);
      }
    }
    updateFrame();
    frameTimer = setInterval(updateFrame, 100);
  }
  questionStartedAt = performance.now();
  questionTimer.hidden = false;
  updateQuestionTimer(0);
  countdownTimer = setInterval(() => {
    const elapsed = performance.now() - questionStartedAt;
    updateQuestionTimer(elapsed);
    if (elapsed >= QUESTION_TIME_LIMIT_MS) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }, 100);
  setButton("Show answer", "↗");
}

function updateQuestionTimer(elapsed) {
  const remaining = Math.max(0, Math.ceil((QUESTION_TIME_LIMIT_MS - elapsed) / 1000));
  questionTimer.textContent = `Time remaining: ${remaining}s`;
  questionTimer.classList.toggle("time-up", remaining === 0);
}

function revealAnswer() {
  const elapsed = performance.now() - questionStartedAt;
  clearInterval(countdownTimer);
  countdownTimer = null;
  updateQuestionTimer(elapsed);
  const question = QUESTIONS[questionIndex];
  stage = "revealed";
  let correctSelections = 0;
  let incorrectSelections = 0;
  grid.querySelectorAll(".anime-card").forEach(card => {
    const correct = question.answers.includes(card.dataset.id);
    const selected = card.getAttribute("aria-pressed") === "true";
    if (selected) {
      if (correct) correctSelections++;
      else incorrectSelections++;
    }
    card.disabled = true;
    if (correct) {
      card.classList.add("correct");
      const label = document.createElement("span");
      label.className = "correct-label";
      label.textContent = "✓ CORRECT";
      card.querySelector(".poster-wrap").append(label);
    } else {
      card.classList.add("dimmed");
    }
  });
  const baseScore = Math.max(0, MAX_QUESTION_POINTS * correctSelections / question.answers.length -
    incorrectSelections * MISTAKE_PENALTY);
  const scoreHundredths = elapsed >= QUESTION_TIME_LIMIT_MS ? 0 :
    Math.floor(baseScore * Math.min(1, (QUESTION_TIME_LIMIT_MS - elapsed) /
      (QUESTION_TIME_LIMIT_MS - FULL_SCORE_TIME_MS[question.type])) * 100);
  totalScoreHundredths += scoreHundredths;
  answeredQuestions++;
  questionScore.textContent = `Question score: ${formatScore(scoreHundredths)} / ${MAX_QUESTION_POINTS}`;
  questionScore.hidden = false;
  updateScore();
  if (question.comment) {
    const heading = document.createElement("h3");
    heading.textContent = "A little extra";
    const text = document.createElement("p");
    const parts = question.comment.split(/(https?:\/\/[^\s,]+)/gi);
    parts.forEach(part => {
      if (/^https?:\/\//i.test(part)) {
        const link = document.createElement("a");
        link.href = part;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = part;
        text.append(link);
      } else {
        text.append(document.createTextNode(part));
      }
    });
    notes.append(heading, text);
    notes.hidden = false;
  }
  actionButton.hidden = questionIndex === QUESTIONS.length - 1;
  setButton("Next question", "→");
  finishButton.hidden = false;
}

actionButton.addEventListener("click", () => {
  if (stage === "ready") startQuestion();
  else if (stage === "started") revealAnswer();
  else if (stage === "revealed" && questionIndex < QUESTIONS.length - 1) {
    questionIndex++;
    showQuestion();
  }
});

function formatScore(hundredths) {
  return (hundredths / 100).toFixed(2).replace(/\.?0+$/, "");
}

function updateScore() {
  scoreLabel.textContent = `SCORE ${formatScore(totalScoreHundredths)} / ${answeredQuestions * MAX_QUESTION_POINTS}`;
}

finishButton.addEventListener("click", () => {
  if (stage !== "revealed") return;
  stopClue();
  stage = "finished";
  resultsScore.textContent = `${formatScore(totalScoreHundredths)} / ${answeredQuestions * MAX_QUESTION_POINTS}`;
  resultsDetail.textContent = `${answeredQuestions} ${answeredQuestions === 1 ? "question" : "questions"} answered.`;
  resultsDialog.showModal();
});

document.getElementById("restart-button").addEventListener("click", () => {
  resultsDialog.close();
  QUESTIONS = shuffle(QUESTIONS);
  questionIndex = 0;
  totalScoreHundredths = 0;
  answeredQuestions = 0;
  updateScore();
  showQuestion();
});

document.getElementById("instructions-button").addEventListener("click", () => instructionsDialog.close());
[instructionsDialog, resultsDialog].forEach(dialog => {
  dialog.addEventListener("cancel", event => event.preventDefault());
});
instructionsDialog.showModal();

function showLoadError(error) {
  roundLabel.textContent = "QUIZ NOT LOADED";
  showError(`Unable to load the quiz: ${error.message}`);
  setButton("Quiz unavailable", "↗");
}

async function initialize() {
  if (location.protocol === "file:") {
    showLoadError(new Error("Open this page through a web server to load the CSV automatically."));
    return;
  }
  try {
    const loadCsv = async path => {
      const response = await fetch(path, { cache: "no-store" });
      if (!response.ok) throw new Error(`CSV request failed for ${path} (HTTP ${response.status}).`);
      return response.text();
    };
    const [questions, anime] = await Promise.all([
      loadCsv("source/GuestAnime%20-%20V2.csv"),
      loadCsv("source/GuestAnime%20-%20Animes.csv")
    ]);
    loadData(questions, anime);
  } catch (error) {
    showLoadError(error);
  }
}

initialize();
