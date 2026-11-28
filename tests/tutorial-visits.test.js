"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const day = 24 * 60 * 60 * 1000;
const anime = "MAL,Name,Photo\n1,A,a\n2,B,b\n3,C,c\n4,D,d\n5,E,e";
const questions = "Respuesta,Distractores,Tipo,Fuente,Comentario Adicional\n1,2,Descripción,clue,";

function openGame(jar, now, blocked = false) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        listeners: {},
        addEventListener(type, handler) { this.listeners[type] = handler; },
        showModal() { this.open = true; },
        close() { this.open = false; },
        append() {},
        replaceChildren() {}
      });
    }
    return elements.get(id);
  }
  const document = {
    get cookie() { return jar.cookie || ""; },
    set cookie(value) { if (!blocked) jar.cookie = value.split(";")[0]; },
    getElementById: element,
    querySelector: element,
    createElement: element,
    createTextNode: () => ({})
  };
  class Clock extends Date {
    static now() { return now; }
  }
  const warnings = [];
  const game = vm.createContext({
    document,
    Date: Clock,
    URLSearchParams,
    location: { protocol: "file:", search: "" },
    console: { warn: (...args) => warnings.push(args) }
  });
  vm.runInContext(app, game);
  vm.runInContext(`
    var demoCount = 0, tutorialCalls = [], questionCount = 0;
    showDemo = () => demoCount++;
    showTutorial = isDemo => { tutorialShown = true; tutorialCalls.push(isDemo); };
    showQuestion = () => questionCount++;
  `, game);
  return { game, elements, warnings };
}

function play(visit, loadFirst = true) {
  if (loadFirst) visit.game.loadData(questions, anime);
  visit.elements.get("instructions-button").listeners.click();
  if (!loadFirst) visit.game.loadData(questions, anime);
}

test("first visit and visits over three days later show the tutorial", () => {
  const jar = {};
  const first = openGame(jar, 10 * day);
  play(first);
  assert.deepEqual(Array.from(first.game.tutorialCalls), [true]);
  assert.equal(first.game.questionCount, 0);

  const later = openGame(jar, 13 * day + 1);
  play(later, false);
  assert.deepEqual(Array.from(later.game.tutorialCalls), [true]);
  assert.equal(later.game.questionCount, 0);
});

test("visits within exactly three days skip the tutorial and refresh the visit time", () => {
  const jar = {};
  play(openGame(jar, 10 * day));
  const second = openGame(jar, 13 * day);
  play(second);
  assert.equal(second.game.tutorialCalls.length, 0);
  assert.equal(second.game.questionCount, 1);
  assert.equal(jar.cookie, `anime_after_hours_last_visit=${13 * day}`);

  const third = openGame(jar, 14 * day);
  play(third, false);
  assert.equal(third.game.tutorialCalls.length, 0);
  assert.equal(third.game.questionCount, 1);
  third.elements.get("tutorial-button").listeners.click();
  assert.deepEqual(Array.from(third.game.tutorialCalls), [undefined]);
});

test("unavailable or invalid cookies show the tutorial without blocking play", () => {
  for (const jar of [{}, { cookie: "anime_after_hours_last_visit=invalid" }]) {
    const visit = openGame(jar, 10 * day, true);
    play(visit);
    assert.deepEqual(Array.from(visit.game.tutorialCalls), [true]);
    assert.equal(visit.warnings.length, 1);
    visit.elements.get("start-game-button").listeners.click();
    assert.equal(visit.game.questionCount, 1);
  }
});
