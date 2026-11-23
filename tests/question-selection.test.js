"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createGame(search = "") {
  const element = () => ({
    addEventListener() {},
    append() {},
    replaceChildren() {},
    showModal() {}
  });
  const context = vm.createContext({
    URLSearchParams,
    location: { protocol: "file:", search },
    document: {
      getElementById: element,
      querySelector: element,
      createElement: element,
      createTextNode: () => ({})
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8"), context);
  return context;
}

function questions(counts) {
  return Object.entries(counts).flatMap(([type, count]) =>
    Array.from({ length: count }, (_, id) => ({ type, id: `${type}-${id}` })));
}

function countsByType(selected) {
  return selected.reduce((counts, question) => {
    counts[question.type] = (counts[question.type] || 0) + 1;
    return counts;
  }, {});
}

test("random selection respects proportions and interleaves types without duplicates", () => {
  const game = createGame();
  const all = questions({ music: 20, description: 10, frames: 10 });
  const selected = game.selectQuestions(all);
  assert.equal(selected.length, 20);
  assert.equal(new Set(selected).size, 20);
  assert.deepEqual(countsByType(selected), { music: 10, description: 5, frames: 5 });
  for (let i = 0; i < selected.length; i += 4) {
    assert.deepEqual(countsByType(selected.slice(i, i + 4)), { music: 2, description: 1, frames: 1 });
  }
  assert.equal(all.length, 40);
});

test("random selection rounds quotas and handles small or single-type datasets", () => {
  const game = createGame();
  assert.deepEqual(countsByType(game.selectQuestions(questions({ music: 21, description: 7, frames: 3 }))),
    { music: 14, description: 4, frames: 2 });
  const small = questions({ music: 3, frames: 2 });
  assert.equal(new Set(game.selectQuestions(small)).size, small.length);
  assert.equal(game.selectQuestions(questions({ music: 30 })).length, 20);
  assert.equal(game.selectQuestions([]).length, 0);
});

test("each random selection samples from the full dataset", () => {
  const game = createGame();
  const all = questions({ music: 30 });
  vm.runInContext("Math.random = () => 0", game);
  const first = game.selectQuestions(all);
  vm.runInContext("Math.random = () => 0.999", game);
  const second = game.selectQuestions(all);
  assert.ok(second.some(question => !first.includes(question)));
});

test("question options always include answers and required distractors, then fill randomly", () => {
  const game = createGame();
  vm.runInContext("ANIME = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} }; Math.random = () => 0", game);
  const selected = vm.runInContext(`selectQuestionOptions({
    answers: ["1", "2"],
    distractors: ["3", "4"],
    otherDistractors: ["5"]
  })`, game);
  const options = Array.from(selected);
  assert.equal(options.length, 5);
  assert.deepEqual(options.filter(id => ["1", "2", "3", "4"].includes(id)).sort(), ["1", "2", "3", "4"]);
  assert.deepEqual(options.filter(id => !["1", "2", "3", "4"].includes(id)), ["6"]);
});

test("ordered mode uses the complete dataset in its original order", () => {
  const game = createGame("?ordered");
  const all = questions({ music: 20, description: 10, frames: 10 });
  const selected = game.selectQuestions(all);
  assert.notEqual(selected, all);
  assert.deepEqual(Array.from(selected), all);
});
