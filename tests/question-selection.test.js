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
      cookie: "",
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

test("normal options include answers and prioritized distractors, then fill randomly", () => {
  const game = createGame();
  vm.runInContext("ANIME = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} }; Math.random = () => 0", game);
  const selected = vm.runInContext(`selectQuestionOptions({
    answers: ["1", "2"],
    distractors: ["3"],
    otherDistractors: ["4"]
  })`, game);
  const options = Array.from(selected);
  assert.equal(options.length, 5);
  assert.equal(new Set(options).size, 5);
  assert.deepEqual(options.filter(id => ["1", "2", "3"].includes(id)).sort(), ["1", "2", "3"]);
  assert.deepEqual(options.filter(id => !["1", "2", "3"].includes(id)).sort(), ["5", "6"]);
});

test("normal options allow five answers and limit excess distractors", () => {
  const game = createGame();
  vm.runInContext("ANIME = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} }", game);
  const allAnswers = game.selectQuestionOptions({
    answers: ["1", "2", "3", "4", "5"],
    distractors: ["6"],
    otherDistractors: []
  });
  assert.deepEqual(Array.from(allAnswers).sort(), ["1", "2", "3", "4", "5"]);
  const prioritized = game.selectQuestionOptions({
    answers: ["1"],
    distractors: ["2", "3", "4", "5", "6"],
    otherDistractors: []
  });
  assert.deepEqual(Array.from(prioritized).sort(), ["1", "2", "3", "4", "5"]);
});

test("rendering and demo use the option count for each mode", () => {
  for (const [search, expected] of [["", 5], ["?ordered", 4]]) {
    const game = createGame(search);
    vm.runInContext(`
      ANIME = { 1: {name: "A", image: "a"}, 2: {name: "B", image: "b"},
                3: {name: "C", image: "c"}, 4: {name: "D", image: "d"},
                5: {name: "E", image: "e"} };
      QUESTIONS = [{}];
      var rendered = 0, columns;
      grid.style = { setProperty: (name, value) => columns = value };
      grid.append = () => rendered++;
      grid.closest = () => ({ classList: { remove() {} } });
      modeBadge.dataset = {};
      document.createElement = () => ({
        dataset: {}, addEventListener() {}, setAttribute() {}, append() {}
      });
      stopClue = () => {};
      setButton = () => {};
      showDemo();
    `, game);
    assert.equal(game.rendered, expected);
    assert.equal(game.columns, expected);
  }
});

test("ordered options prioritize other distractors before random fillers", () => {
  const game = createGame("?ordered");
  vm.runInContext("ANIME = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} }; Math.random = () => 0", game);
  const selected = game.selectQuestionOptions({
    answers: ["1"],
    distractors: ["2"],
    otherDistractors: ["3", "4"]
  });
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected).size, 4);
  assert.ok(["1", "2", "3", "4"].every(id => selected.includes(id)));
});

test("ordered options use only available slots and avoid duplicate other distractors", () => {
  const game = createGame("?ordered");
  vm.runInContext("ANIME = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {} }", game);
  const selected = game.selectQuestionOptions({
    answers: ["1"],
    distractors: ["2", "3"],
    otherDistractors: ["1", "4", "4", "5", "6"]
  });
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected).size, 4);
  assert.ok(["1", "2", "3"].every(id => selected.includes(id)));
  assert.ok(selected.includes("4"));
  assert.ok(!selected.includes("5") && !selected.includes("6"));
  assert.ok(!selected.includes("7"));
});

test("ordered options fill remaining slots randomly after other distractors", () => {
  const game = createGame("?ordered");
  vm.runInContext("ANIME = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} }; Math.random = () => 0", game);
  const selected = game.selectQuestionOptions({
    answers: ["1"],
    distractors: ["2"],
    otherDistractors: ["3"]
  });
  assert.equal(selected.length, 4);
  assert.ok(["1", "2", "3"].every(id => selected.includes(id)));
  assert.equal(selected.filter(id => id === "4" || id === "5").length, 1);
});

test("four answers take priority and excess distractors are ignored", () => {
  const game = createGame("?ordered");
  vm.runInContext("ANIME = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} }", game);
  const allAnswers = game.selectQuestionOptions({
    answers: ["1", "2", "3", "4"],
    distractors: ["5"],
    otherDistractors: ["6"]
  });
  assert.deepEqual(Array.from(allAnswers).sort(), ["1", "2", "3", "4"]);
  const prioritized = game.selectQuestionOptions({
    answers: ["1"],
    distractors: ["2", "3", "4", "5"],
    otherDistractors: ["6"]
  });
  assert.deepEqual(Array.from(prioritized).sort(), ["1", "2", "3", "4"]);
});

test("loading allows extra distractors but rejects more than four answers", () => {
  const game = createGame("?ordered");
  vm.runInContext("showDemo = () => {}; instructionsDialog.open = true", game);
  const anime = "MAL,Name,Photo\n1,A,a\n2,B,b\n3,C,c\n4,D,d\n5,E,e";
  const header = "Respuesta,Distractores,Otros Distractores,Tipo,Fuente,Comentario Adicional\n";
  assert.doesNotThrow(() => game.loadData(header + "1 2 3 4,99,99,Musica,clue,", anime));
  assert.throws(() => game.loadData(header + "1 2 3 4 5,,,Musica,clue,", anime), /invalid answers/);
});

test("normal mode requires five anime and accepts up to five answers", () => {
  const game = createGame();
  vm.runInContext("showDemo = () => {}; instructionsDialog.open = true", game);
  const fourAnime = "MAL,Name,Photo\n1,A,a\n2,B,b\n3,C,c\n4,D,d";
  const fiveAnime = fourAnime + "\n5,E,e";
  const sixAnime = fiveAnime + "\n6,F,f";
  const header = "Respuesta,Distractores,Tipo,Fuente,Comentario Adicional\n";
  assert.throws(() => game.loadData(header + "1,,Musica,clue,", fourAnime), /invalid answers/);
  assert.doesNotThrow(() => game.loadData(header + "1 2 3 4 5,,Musica,clue,", fiveAnime));
  assert.throws(() => game.loadData(header + "1 2 3 4 5 6,,Musica,clue,", sixAnime), /invalid answers/);
});

test("loading parses optional other distractors and validates them only in ordered mode", () => {
  const anime = "MAL,Name,Photo\n1,A,a\n2,B,b\n3,C,c\n4,D,d\n5,E,e";
  const header = "Respuesta,Distractores,Otros Distractores,Tipo,Fuente,Comentario Adicional\n";
  const csv = header + '1,2,"3, 4",Descripción,clue,';
  const ordered = createGame("?ordered");
  vm.runInContext("showDemo = () => {}; instructionsDialog.open = true", ordered);
  ordered.loadData(csv, anime);
  assert.deepEqual(Array.from(vm.runInContext("QUESTIONS[0].otherDistractors", ordered)), ["3", "4"]);
  assert.throws(() => ordered.loadData(header + "1,2,99,Descripción,clue,", anime), /invalid other distractor/);
  ordered.loadData("Respuesta,Distractores,Tipo,Fuente,Comentario Adicional\n1,2,Descripción,clue,", anime);
  assert.equal(vm.runInContext("QUESTIONS[0].otherDistractors.length", ordered), 0);

  const normal = createGame();
  vm.runInContext("showDemo = () => {}; instructionsDialog.open = true", normal);
  assert.doesNotThrow(() => normal.loadData(header + "1,2,99,Descripción,clue,", anime));
});

test("loading accepts space-separated IDs and frame filenames", () => {
  const game = createGame("?ordered");
  vm.runInContext("showDemo = () => {}; instructionsDialog.open = true", game);
  const anime = "MAL,Name,Photo\n1,A,a\n2,B,b\n3,C,c\n4,D,d\n5,E,e\n6,F,f";
  const header = "Respuesta,Distractores,Otros Distractores,Tipo,Fuente,Comentario Adicional\n";
  const frames = "frame_one frame_two frame_three";
  game.loadData(header + `1  2,3\t4,5 6,Frames,${frames},\n"1, 2","3, 4","5, 6",Frames,${frames},`, anime);
  for (const question of vm.runInContext("QUESTIONS", game)) {
    assert.deepEqual(Array.from(question.answers), ["1", "2"]);
    assert.deepEqual(Array.from(question.distractors), ["3", "4"]);
    assert.deepEqual(Array.from(question.otherDistractors), ["5", "6"]);
    assert.deepEqual(Array.from(question.source), ["frame_one", "frame_two", "frame_three"]);
  }
});

test("ordered mode uses the complete dataset in its original order", () => {
  const game = createGame("?ordered");
  const all = questions({ music: 20, description: 10, frames: 10 });
  const selected = game.selectQuestions(all);
  assert.notEqual(selected, all);
  assert.deepEqual(Array.from(selected), all);
});
