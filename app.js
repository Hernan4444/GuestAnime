"use strict";

const FRAME_DURATION_MS = 6000;
const MUSIC_START_WINDOW_SECONDS = 5;
const DEFAULT_MUSIC_VOLUME = 0.6;
const MAX_QUESTION_POINTS = 10;
const MISTAKE_PENALTY = 3;
const RANDOM_QUESTION_COUNT = 20;
const QUESTION_OPTION_COUNT = new URLSearchParams(location.search).has("ordered") ? 4 : 5;
const FULL_SCORE_TIME_MS = {
  music: 5000,
  description: 10000,
  frames: 7000
};
const QUESTION_TIME_LIMIT_MS = 45000;
const TUTORIAL_RETURN_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const LAST_VISIT_COOKIE = "anime_after_hours_last_visit";
const SPREADSHEET_EXPORT_URL = "https://docs.google.com/spreadsheets/d/11yaou7CKAUe7ebrMjAoYG-JCx-pWR0FT2YPAb63tXKs/export?format=csv";
const QUESTION_SHEET_GID = "637749647";
const ANIME_SHEET_GID = "644290686";

const grid = document.getElementById("anime-grid");
const roundLabel = document.getElementById("round-label");
const modeBadge = document.getElementById("mode-badge");
const modeLabel = document.getElementById("mode-label");
const clueTitle = document.getElementById("clue-title");
const clueHint = document.getElementById("clue-hint");
const clueContent = document.getElementById("clue-content");
const notes = document.getElementById("answer-notes");
const notesText = document.getElementById("answer-notes-text");
const errorMessage = document.getElementById("error-message");
const actionButton = document.getElementById("action-button");
const tutorialButton = document.getElementById("tutorial-button");
const pageShell = document.querySelector(".page-shell");
const startGameOverlay = document.getElementById("start-game-overlay");
const startGameButton = document.getElementById("start-game-button");
const startGameError = document.getElementById("start-game-error");
const finishButton = document.getElementById("finish-button");
const scoreLabel = document.getElementById("score-label");
const questionScore = document.getElementById("question-score");
const questionTimer = document.getElementById("question-timer");
const instructionsDialog = document.getElementById("instructions-dialog");
const resultsDialog = document.getElementById("results-dialog");
const resultsScore = document.getElementById("results-score");
const resultsDetail = document.getElementById("results-detail");

let ANIME = {};
let ALL_QUESTIONS = [];
let QUESTIONS = [];
let questionIndex = 0;
let stage = "ready";
let frameTimer = null;
let countdownTimer = null;
let currentAudio = null;
let preparedFrames = [];
let preparationId = 0;
let questionStartedAt = null;
let totalScoreHundredths = 0;
let answeredQuestions = 0;
let quizLoaded = false;
let initializationId = 0;
let tutorialShown = false;
let gameStarted = false;
const shouldShowInitialTutorial = recordVisit();

function recordVisit() {
  const now = Date.now();
  try {
    const cookie = document.cookie.split("; ").find(item => item.startsWith(`${LAST_VISIT_COOKIE}=`));
    const value = cookie && cookie.slice(LAST_VISIT_COOKIE.length + 1);
    const lastVisit = value && /^\d+$/.test(value) ? Number(value) : NaN;
    document.cookie = `${LAST_VISIT_COOKIE}=${now}; Max-Age=34560000; SameSite=Lax`;
    if (!document.cookie.split("; ").includes(`${LAST_VISIT_COOKIE}=${now}`)) {
      console.warn("Could not save the last visit cookie; the tutorial may appear again.");
    }
    return !Number.isSafeInteger(lastVisit) || lastVisit > now || now - lastVisit > TUTORIAL_RETURN_INTERVAL_MS;
  } catch (error) {
    console.warn("Could not access the last visit cookie; the tutorial will be shown.", error);
    return true;
  }
}

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
  questionColumn["Otros Distractores"] = questionHeaders.indexOf("Otros Distractores");
  const animeColumn = Object.fromEntries(animeColumns.map(name => [name, animeHeaders.indexOf(name)]));
  const anime = {};
  const questions = [];
  const splitIds = value => value.split(/[,\s]+/).filter(Boolean);
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
    if (get("Respuesta") || get("Distractores") || get("Otros Distractores") || get("Tipo") || get("Fuente") || get("Comentario Adicional")) {
      const type = types[get("Tipo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()];
      questions.push({
        type,
        answers: splitIds(get("Respuesta")),
        distractors: splitIds(get("Distractores")),
        otherDistractors: splitIds(get("Otros Distractores")),
        source: type === "frames" ? get("Fuente").split(" ").map(item => item.trim()).filter(Boolean) : get("Fuente"),
        comment: get("Comentario Adicional")
      });
    }
  });
  ANIME = anime;
  QUESTIONS = questions;
  validateData();
  ALL_QUESTIONS = questions;
  QUESTIONS = selectQuestions(ALL_QUESTIONS);
  quizLoaded = true;
  questionIndex = 0;
  if (gameStarted) {
    showQuestion();
  } else {
    showDemo();
    if (!instructionsDialog.open) beginAfterInstructions();
  }
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function requiredQuestionOptions(question) {
  return [...question.answers, ...question.distractors.slice(0, Math.max(0, QUESTION_OPTION_COUNT - question.answers.length))];
}

function orderedQuestionOptions(question, required) {
  if (!new URLSearchParams(location.search).has("ordered")) return [];
  return [...new Set(question.otherDistractors.filter(id => !required.includes(id)))]
    .slice(0, Math.max(0, QUESTION_OPTION_COUNT - required.length));
}

function selectQuestionOptions(question) {
  const required = requiredQuestionOptions(question);
  const additional = orderedQuestionOptions(question, required);
  const choices = [...required, ...additional];
  const fillers = shuffle(Object.keys(ANIME).filter(id => !choices.includes(id)));
  return shuffle([...choices, ...fillers.slice(0, QUESTION_OPTION_COUNT - choices.length)]);
}

function selectQuestions(questions) {
  if (new URLSearchParams(location.search).has("ordered")) return [...questions];

  const total = Math.min(RANDOM_QUESTION_COUNT, questions.length);
  const groups = shuffle([...new Set(questions.map(question => question.type))]).map(type => {
    const items = shuffle(questions.filter(question => question.type === type));
    const scaledCount = items.length * total;
    return {
      items,
      count: Math.floor(scaledCount / questions.length),
      remainder: scaledCount % questions.length,
      weight: 0,
      drawn: 0
    };
  });
  let remaining = total - groups.reduce((sum, group) => sum + group.count, 0);
  groups.sort((a, b) => b.remainder - a.remainder);
  for (const group of groups) {
    if (!remaining) break;
    group.count++;
    remaining--;
  }

  const selected = [];
  for (let i = 0; i < total; i++) {
    for (const group of groups) group.weight += group.count;
    const next = groups.filter(group => group.drawn < group.count)
      .reduce((best, group) => !best || group.weight > best.weight ? group : best, null);
    selected.push(next.items.pop());
    next.weight -= total;
    next.drawn++;
  }
  return selected;
}

function validateData() {
  if (Object.values(FULL_SCORE_TIME_MS).some(time => !Number.isFinite(time) || time < 0 || time >= QUESTION_TIME_LIMIT_MS)) {
    throw new Error("Full-score times must be non-negative and shorter than the question time limit.");
  }
  if (!QUESTIONS.length) throw new Error("There are no questions to play.");
  for (const [index, question] of QUESTIONS.entries()) {
    const choices = requiredQuestionOptions(question);
    if (!question.answers.length || question.answers.length > QUESTION_OPTION_COUNT ||
        new Set(choices).size !== choices.length ||
        choices.some(id => !ANIME[id]) || Object.keys(ANIME).length < QUESTION_OPTION_COUNT) {
      throw new Error(`Question ${index + 1} has invalid answers or anime IDs.`);
    }
    if (orderedQuestionOptions(question, choices).some(id => !ANIME[id])) {
      throw new Error(`Question ${index + 1} has invalid other distractor anime IDs.`);
    }
    if (!["music", "description", "frames"].includes(question.type) ||
        (question.type === "frames" ? !Array.isArray(question.source) || question.source.length !== 3 : typeof question.source !== "string" || !question.source.trim())) {
      throw new Error(`Question ${index + 1} has an invalid clue. ${JSON.stringify(question)}`);
    }
  }
}

function stopClue() {
  preparationId++;
  clearInterval(frameTimer);
  frameTimer = null;
  clearInterval(countdownTimer);
  countdownTimer = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute("src");
    currentAudio.load();
    currentAudio = null;
  }
  preparedFrames = [];
}

function setButton(label, symbol) {
  actionButton.replaceChildren(document.createTextNode(label + " "));
  const arrow = document.createElement("span");
  arrow.textContent = symbol;
  actionButton.append(arrow);
}

function renderOptions(options) {
  grid.style.setProperty("--option-count", QUESTION_OPTION_COUNT);
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
      selection.textContent = selected ? "✓ YOUR PICK" : "+ SELECT";
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
    selection.textContent = "+ SELECT";
    imageWrap.append(image, selection);
    const name = document.createElement("span");
    name.className = "anime-name";
    name.textContent = ANIME[id].name;
    card.append(imageWrap, name);
    grid.append(card);
  });
}

function showDemo() {
  stopClue();
  stage = "demo";
  grid.closest(".game").classList.remove("frames-round");
  roundLabel.textContent = `QUESTION 00 / ${String(QUESTIONS.length).padStart(2, "0")} · DEMO`;
  modeLabel.textContent = "DEMO ROUND";
  delete modeBadge.dataset.type;
  renderOptions(shuffle(Object.keys(ANIME)).slice(0, QUESTION_OPTION_COUNT));
  clueTitle.textContent = "Example clue";
  clueHint.textContent = "This is a demonstration of the quiz.";
  clueContent.innerHTML = '<div class="clue-placeholder" aria-hidden="true"><span>✳</span> YOUR CLUE AWAITS</div>';
  notesText.textContent = "No additional information yet.";
  errorMessage.hidden = true;
  questionScore.hidden = true;
  questionTimer.hidden = true;
  actionButton.hidden = false;
  actionButton.disabled = true;
  setButton("Show clue", "↗");
}

function showQuestion() {
  stopClue();
  stage = "ready";
  questionStartedAt = null;
  const question = QUESTIONS[questionIndex];
  grid.closest(".game").classList.toggle("frames-round", question.type === "frames");
  const options = selectQuestionOptions(question);

  roundLabel.textContent = `QUESTION ${String(questionIndex + 1).padStart(2, "0")} / ${String(QUESTIONS.length).padStart(2, "0")}`;

  modeLabel.textContent = { music: "MUSIC ROUND", description: "DESCRIPTION ROUND", frames: "FRAMES ROUND" }[question.type];
  modeBadge.dataset.type = question.type;
  renderOptions(options);
  clueTitle.textContent = {
    music: "Listen closely.",
    description: "Read between the lines.",
    frames: "Watch the frames."
  }[question.type];
  clueHint.textContent = {
    music: "Play, pause, or seek. The anime may use a different version or cover.",
    description: "Which story does this sound like?",
    frames: `A new frame appears every ${FRAME_DURATION_MS / 1000} seconds.`
  }[question.type];
  clueContent.innerHTML = '<div class="clue-placeholder" aria-hidden="true"><span>✳</span> YOUR CLUE AWAITS</div>';
  notesText.textContent = "No additional information yet.";
  errorMessage.hidden = true;
  questionScore.hidden = true;
  questionTimer.hidden = true;
  actionButton.hidden = false;
  prepareClue(question);
  tutorialButton.disabled = false;
}

function setStartGate(visible) {
  startGameOverlay.hidden = !visible;
  startGameButton.hidden = !visible;
  pageShell.inert = visible;
}

function startGame() {
  setStartGate(false);
  startGameError.hidden = true;
  gameStarted = true;
  questionIndex = 0;
  showQuestion();
}

function beginAfterInstructions() {
  if (!quizLoaded || gameStarted || tutorialShown) return;
  if (shouldShowInitialTutorial) showTutorial(true);
  else startGame();
}

function showTutorial(isDemo = false) {
  tutorialShown = true;
  if (typeof introJs !== "function") {
    if (isDemo) {
      startGameError.textContent = "The tutorial could not be loaded. You can still play the quiz.";
      startGameError.hidden = false;
      setStartGate(true);
      startGameButton.focus();
    } else {
      showError("The tutorial could not be loaded. You can still play the quiz.");
    }
    return;
  }

  const actionIntro = {
    demo: "In a real question, press Show clue to reveal the clue and start the 45-second timer. After choosing, use this button to submit and reveal the answers.",
    loading: "The clue is loading. When it is ready, press Show clue to reveal it and start the 45-second timer.",
    "load-error": "Use this button to retry loading the clue before starting the question.",
    ready: "Press Show clue to reveal the clue and start the 45-second timer. After choosing, use this button to submit and reveal the answers.",
    started: "The question is running. Use this button to submit your picks and reveal the answers.",
    revealed: "Use this button to move on to the next question."
  }[stage];
  const steps = [
    { element: modeBadge, intro: `${isDemo ? "This is a demo question. " : ""}This shows the type of clue for the current question.${stage === "started" ? " The timer keeps running while the tutorial is open." : ""}` },
    ...(!actionButton.hidden ? [{ element: actionButton, intro: actionIntro }] : []),
    { element: clueContent, intro: "The clue appears here after you start. The clues can be music, descriptions, or frames." },
    { element: grid, intro: `${isDemo ? "These anime are random examples. " : ""}The options for each question are shown before it starts. We suggest reviewing them before you start. ${stage === "revealed" ? "The correct answers are highlighted here." : "Click every matching anime: <b>you can select more than one.</b>"}` },
    { element: notes, intro: "After you submit, some questions show additional information and links here to support the answer." },
    { element: document.querySelector(".score-controls"), intro: "Your score appears here. Finish the game at any time." }
  ];
  if (isDemo) {
    steps.push({ element: startGameButton, intro: "Finish the tutorial, then press Start game to begin the first question. Its anime options will be shown before you reveal its clue." });
  } else if (!actionButton.hidden) {
    steps.push({ element: actionButton, intro: {
      loading: "Review the anime names while the clue loads, then press Show clue when you are ready.",
      "load-error": "Retry loading the clue, then review the anime names before starting the question.",
      ready: "Press Show clue to begin this question. The anime on screen are its options, so review their names before you start.",
      started: "Choose all matching anime, then press Submit & reveal answer.",
      revealed: "Press Next question when you are ready to continue."
    }[stage] });
  }
  const tutorial = introJs().setOptions({
    steps,
    disableInteraction: true,
    exitOnOverlayClick: false,
    showBullets: false,
    doneLabel: "Done"
  });
  if (isDemo) {
    tutorial.onbeforechange(element => setStartGate(element === startGameButton));
    tutorial.onexit(() => {
      setStartGate(true);
      startGameButton.focus();
    });
    tutorial.oncomplete(() => {
      setStartGate(true);
      startGameButton.focus();
    });
  }
  tutorial.start();
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function prepareClue(question) {
  const id = ++preparationId;
  stage = "loading";
  errorMessage.hidden = true;
  actionButton.disabled = true;
  setButton("Loading clue", "…");

  let loading = Promise.resolve();
  if (question.type === "music") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "auto";
    audio.volume = DEFAULT_MUSIC_VOLUME;
    currentAudio = audio;
    loading = new Promise((resolve, reject) => {
      const ready = () => {
        if (!audio.seeking && audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) resolve();
      };
      audio.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          audio.currentTime = Math.random() * Math.min(MUSIC_START_WINDOW_SECONDS, audio.duration);
        }
        ready();
      }, { once: true });
      audio.addEventListener("seeked", ready);
      audio.addEventListener("canplaythrough", ready);
      audio.addEventListener("error", () => {
        if (stage === "started" && currentAudio === audio) {
          showError("The audio could not be loaded. Check that the music file is available.");
        }
        reject(new Error("The audio could not be loaded. Check that the music file is available."));
      });
      audio.src = `source/music/${encodeURIComponent(question.source)}.mp3`;
      audio.load();
    });
  } else if (question.type === "frames") {
    loading = Promise.all(question.source.map(source => new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => reject(new Error("A frame could not be loaded. Check that the image files are available.")), { once: true });
      image.src = `source/frames/${encodeURIComponent(source)}.jpg`;
    }))).then(images => {
      if (id === preparationId) preparedFrames = images;
    });
  }

  loading.then(() => {
    if (id !== preparationId) return;
    stage = "ready";
    setButton("Show clue", "↗");
    actionButton.disabled = false;
  }).catch(error => {
    if (id !== preparationId) return;
    stage = "load-error";
    showError(error.message);
    setButton("Retry loading", "↻");
    actionButton.disabled = false;
  });
}

function startQuestion() {
  const question = QUESTIONS[questionIndex];
  stage = "started";
  clueContent.replaceChildren();
  if (question.type === "music") {
    const audio = currentAudio;
    clueContent.append(audio);
    audio.play().catch(() => {
      if (!audio.error) showError("Playback could not start automatically. Press play on the audio player.");
    });
  } else if (question.type === "description") {
    const quote = document.createElement("blockquote");
    quote.textContent = question.source;
    clueContent.append(quote);
  } else {
    const frameBox = document.createElement("div");
    frameBox.className = "frame-box";
    const frameLabel = document.createElement("span");
    frameLabel.className = "frame-label";
    const timer = document.createElement("div");
    timer.className = "frame-timer";
    const timerValue = document.createElement("span");
    timerValue.className = "timer-value";
    timer.append(timerValue);
    frameBox.append(frameLabel, timer);
    clueContent.append(frameBox);
    const startedAt = performance.now();
    let displayedFrame = -1;
    function updateFrame() {
      const elapsed = Math.max(0, performance.now() - startedAt);
      const frame = Math.min(2, Math.floor(elapsed / FRAME_DURATION_MS));
      if (frame !== displayedFrame) {
        displayedFrame = frame;
        const image = preparedFrames[frame];
        image.alt = `Anime clue, frame ${frame + 1} of 3`;
        frameBox.replaceChildren(image, frameLabel, timer);
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
  setButton("Submit & reveal answer", "↗");
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
    const list = document.createElement("ol");
    question.comment.split(" ").filter(Boolean).forEach(url => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = url;
      item.append(link);
      list.append(item);
    });
    notesText.replaceChildren(list);
  } else {
    notesText.textContent = "No additional information for this question.";
  }
  actionButton.hidden = questionIndex === QUESTIONS.length - 1;
  setButton("Next question", "→");
}

actionButton.addEventListener("click", () => {
  if (stage === "ready") startQuestion();
  else if (stage === "load-error") {
    stopClue();
    prepareClue(QUESTIONS[questionIndex]);
  }
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
  if (stage === "finished") return;
  initializationId++;
  stopClue();
  stage = "finished";
  resultsScore.textContent = `${formatScore(totalScoreHundredths)} / ${answeredQuestions * MAX_QUESTION_POINTS}`;
  resultsDetail.textContent = `${answeredQuestions} ${answeredQuestions === 1 ? "question" : "questions"} answered.`;
  resultsDialog.showModal();
});

document.getElementById("restart-button").addEventListener("click", () => {
  resultsDialog.close();
  questionIndex = 0;
  totalScoreHundredths = 0;
  answeredQuestions = 0;
  updateScore();
  if (quizLoaded) {
    QUESTIONS = selectQuestions(ALL_QUESTIONS);
    if (gameStarted) showQuestion();
    else {
      showDemo();
      if (!instructionsDialog.open) beginAfterInstructions();
    }
  } else {
    initialize();
  }
});

document.getElementById("instructions-button").addEventListener("click", () => {
  instructionsDialog.close();
  beginAfterInstructions();
});
tutorialButton.addEventListener("click", () => showTutorial());
startGameButton.addEventListener("click", startGame);
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
  const id = ++initializationId;
  stage = "loading";
  tutorialButton.disabled = true;
  roundLabel.textContent = "LOADING QUIZ";
  errorMessage.hidden = true;
  actionButton.disabled = true;
  setButton("Loading", "↗");
  if (location.protocol === "file:") {
    showLoadError(new Error("Open this page through a web server to load the spreadsheet."));
    return;
  }
  try {
    const loadCsv = async (name, gid) => {
      let response;
      try {
        response = await fetch(`${SPREADSHEET_EXPORT_URL}&gid=${gid}`, { cache: "no-store" });
      } catch (error) {
        throw new Error(`Could not download the ${name} sheet. Check your internet connection and spreadsheet sharing settings. ${error.message}`);
      }
      if (!response.ok) throw new Error(`Could not download the ${name} sheet (HTTP ${response.status}).`);
      return response.text();
    };
    const [questions, anime] = await Promise.all([
      loadCsv("V2", QUESTION_SHEET_GID),
      loadCsv("Animes", ANIME_SHEET_GID)
    ]);
    if (id !== initializationId) return;
    loadData(questions, anime);
  } catch (error) {
    if (id === initializationId) showLoadError(error);
  }
}

initialize();
