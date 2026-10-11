"use strict";

const el = id => document.getElementById(id);
const MAX_OPTIONS = 255;
let questions = [], examples = [], history = [];
let sequence = 0, busy = false, modelReady = false, validationShown = false;
let sourceExample = null;
let modelRun = null;

function node(parent, tag, text = "", className = "") {
  const item = document.createElement(tag);
  item.textContent = text;
  if (className) item.className = className;
  parent.append(item);
  return item;
}

function button(parent, text, action, label = text) {
  const item = node(parent, "button", text);
  item.type = "button";
  item.setAttribute("aria-label", label);
  item.onclick = action;
  return item;
}

function field(parent, label, id, value, onInput, options = {}) {
  const wrapper = node(parent, "div");
  const caption = node(wrapper, "label", label);
  caption.htmlFor = id;
  const input = node(wrapper, options.multiline ? "textarea" : "input");
  input.id = id;
  input.value = value;
  input.placeholder = options.placeholder || "";
  if (options.multiline) input.rows = options.rows || 2;
  else input.type = "text";
  if (options.required) input.setAttribute("aria-required", "true");
  input.oninput = () => { onInput(input.value); changed(); };
  return input;
}

function newQuestion() {
  const uid = ++sequence;
  return {
    uid, name: `question_${uid}`, type: "choice", instructions: "",
    choices: [{ name: "", description: "" }, { name: "", description: "" }],
    levels: ["", ""], yes: "", no: "", result: null, resultStale: false
  };
}

function issues() {
  const errors = [];
  const add = (id, message, uid = null) => errors.push({ id, message, uid });
  if (!el("state").value.trim()) add("state", "State is required.");
  if (!questions.length) add("add-question", "Add at least one question.");
  const names = new Set();
  for (const [index, q] of questions.entries()) {
    const prefix = `Question ${index + 1}`;
    const name = q.name.trim();
    if (!name) add(`q-${q.uid}-name`, `${prefix}: enter a question name.`, q.uid);
    else if (names.has(name)) add(`q-${q.uid}-name`, `${prefix}: question name '${name}' is already used.`, q.uid);
    names.add(name);
    if (!q.instructions.trim()) add(`q-${q.uid}-instructions`, `${prefix}: instructions are required.`, q.uid);
    if (q.type === "choice") {
      if (q.choices.length < 2 || q.choices.length > MAX_OPTIONS) add(`q-${q.uid}-add-choice`, `${prefix}: use 2–255 choices.`, q.uid);
      const labels = new Set();
      for (const [i, choice] of q.choices.entries()) {
        const label = choice.name.trim();
        if (!label) add(`q-${q.uid}-choice-${i}`, `${prefix}: choice ${i + 1} needs a name.`, q.uid);
        else if (labels.has(label)) add(`q-${q.uid}-choice-${i}`, `${prefix}: choice name '${label}' is already used.`, q.uid);
        labels.add(label);
      }
    } else if (q.type === "score") {
      if (q.levels.length < 2 || q.levels.length > MAX_OPTIONS) add(`q-${q.uid}-add-level`, `${prefix}: use 2–255 score levels.`, q.uid);
      const labels = new Set();
      for (const [i, level] of q.levels.entries()) {
        const label = level.trim();
        if (!label) add(`q-${q.uid}-level-${i}`, `${prefix}: score level ${i} needs a description.`, q.uid);
        else if (labels.has(label)) add(`q-${q.uid}-level-${i}`, `${prefix}: score level '${label}' is already used.`, q.uid);
        labels.add(label);
      }
    }
  }
  return errors;
}

function payload() {
  const entries = questions.map(q => {
    const question = { type: q.type, instructions: q.instructions.trim() };
    if (q.type === "choice") {
      question.criteria = Object.fromEntries(q.choices.map(c => [c.name.trim(), c.description.trim() || null]));
    } else if (q.type === "score") {
      question.criteria = q.levels.map(level => level.trim());
    } else if (q.yes.trim() || q.no.trim()) {
      question.criteria = { true: q.yes.trim() || null, false: q.no.trim() || null };
    }
    return [q.name.trim(), question];
  });
  return { model: "kev-latest", state: el("state").value, questions: Object.fromEntries(entries) };
}

function showValidation(errors) {
  el("validation").replaceChildren();
  el("validation").hidden = !errors.length;
  document.querySelectorAll('[aria-invalid="true"]').forEach(input => input.removeAttribute("aria-invalid"));
  document.querySelectorAll(".question-error").forEach(box => { box.textContent = ""; box.hidden = true; });
  if (!errors.length) return;
  node(el("validation"), "strong", "Complete these fields before running:");
  const list = node(el("validation"), "ul");
  for (const error of errors) {
    node(list, "li", error.message);
    el(error.id)?.setAttribute("aria-invalid", "true");
    if (error.uid !== null) {
      const box = el(`q-${error.uid}-error`);
      if (box) { box.hidden = false; box.textContent += (box.textContent ? " " : "") + error.message; }
    }
  }
}

function update() {
  const errors = issues();
  el("question-count").textContent = questions.length;
  el("empty-questions").hidden = questions.length > 0;
  el("state-count").textContent = `${el("state").value.length.toLocaleString()} / 16,000 characters`;
  el("request-preview").textContent = errors.length
    ? "Complete the form to preview a valid request.\n\n" + errors.map(e => e.message).join("\n")
    : JSON.stringify(payload(), null, 2);
  const select = el("permutation-question"), selected = select.value;
  select.replaceChildren();
  const choices = questions.filter(q => q.type === "choice");
  if (!choices.length) {
    const option = node(select, "option", "Add a Choice question first"); option.value = "";
  } else {
    for (const q of choices) { const option = node(select, "option", q.name.trim() || "Unnamed question"); option.value = q.uid; }
    if (choices.some(q => String(q.uid) === selected)) select.value = selected;
  }
  el("run").disabled = busy || !modelReady;
  el("shuffle").disabled = busy || !modelReady || !choices.length;
  select.disabled = busy || !choices.length;
  el("export").disabled = !history.length;
  if (validationShown) showValidation(errors);
}

function changed() {
  sourceExample = null;
  el("example-note").hidden = true;
  questions.forEach(q => { if (q.result) { q.resultStale = true; renderResult(q); } });
  if (el("permutation-result").childElementCount && !el("permutation-result").querySelector(".stale")) {
    const warning = document.createElement("p"); warning.className = "stale small";
    warning.textContent = "Input changed. These option-order results belong to the previous request.";
    el("permutation-result").prepend(warning);
  }
  if (history.length) el("timing").textContent = "Input changed. Run again to refresh results.";
  update();
}

function renderType(q, container) {
  container.replaceChildren();
  if (q.type === "choice") {
    node(container, "h3", "Choices");
    node(container, "p", "Give each choice a unique name. Descriptions are optional.", "small");
    q.choices.forEach((choice, i) => {
      const row = node(container, "div", "", "option-row");
      field(row, `Choice ${i + 1} name`, `q-${q.uid}-choice-${i}`, choice.name, value => choice.name = value, { required: true, placeholder: "e.g. billing" });
      const description = field(row, `Choice ${i + 1} description`, `q-${q.uid}-description-${i}`, choice.description, value => choice.description = value, { placeholder: "When should this be chosen?" });
      description.parentElement.className = "option-description";
      button(row, "Remove", () => { q.choices.splice(i, 1); renderType(q, container); changed(); }, `Remove choice ${i + 1} from question ${q.uid}`);
    });
    const add = button(container, "+ Add choice", () => {
      q.choices.push({ name: "", description: "" }); renderType(q, container); changed();
      el(`q-${q.uid}-choice-${q.choices.length - 1}`).focus();
    });
    add.id = `q-${q.uid}-add-choice`; add.disabled = q.choices.length >= MAX_OPTIONS;
  } else if (q.type === "noul") {
    node(container, "h3", "Yes / No meanings");
    node(container, "p", "Optional descriptions help define what Yes and No mean. The result is P(yes).", "small");
    const row = node(container, "div", "", "yes-no");
    field(row, "Yes description (optional)", `q-${q.uid}-yes`, q.yes, value => q.yes = value, { multiline: true });
    field(row, "No description (optional)", `q-${q.uid}-no`, q.no, value => q.no = value, { multiline: true });
  } else {
    node(container, "h3", "Score levels");
    node(container, "p", "Order levels from lowest to highest. The score is an expected index starting at 0.", "small");
    q.levels.forEach((level, i) => {
      const row = node(container, "div", "", "score-row");
      const caption = node(row, "label", String(i)); caption.htmlFor = `q-${q.uid}-level-${i}`;
      const input = node(row, "input"); input.id = caption.htmlFor; input.type = "text";
      input.value = level; input.placeholder = `Describe level ${i}`;
      input.setAttribute("aria-label", `Score level ${i} for question ${q.uid}`);
      input.setAttribute("aria-required", "true");
      input.oninput = () => { q.levels[i] = input.value; changed(); };
      const move = delta => {
        [q.levels[i], q.levels[i + delta]] = [q.levels[i + delta], q.levels[i]];
        renderType(q, container); changed(); el(`q-${q.uid}-level-${i + delta}`).focus();
      };
      button(row, "↑", () => move(-1), `Move score level ${i} up`).disabled = i === 0;
      button(row, "↓", () => move(1), `Move score level ${i} down`).disabled = i === q.levels.length - 1;
      button(row, "Remove", () => { q.levels.splice(i, 1); renderType(q, container); changed(); }, `Remove score level ${i} from question ${q.uid}`);
    });
    const add = button(container, "+ Add level", () => {
      q.levels.push(""); renderType(q, container); changed(); el(`q-${q.uid}-level-${q.levels.length - 1}`).focus();
    });
    add.id = `q-${q.uid}-add-level`; add.disabled = q.levels.length >= MAX_OPTIONS;
  }
}

function renderCard(q, index) {
  const card = node(el("questions"), "section", "", "panel question-card"); card.id = `question-${q.uid}`;
  const heading = node(card, "div", "", "section-heading");
  node(heading, "h3", `Question ${index + 1}`);
  button(heading, "Remove question", () => {
    questions = questions.filter(item => item.uid !== q.uid); renderCards(); changed();
  }, `Remove question ${index + 1}`);
  const meta = node(card, "div", "", "question-meta");
  field(meta, "Question name", `q-${q.uid}-name`, q.name, value => q.name = value, { required: true, placeholder: "e.g. department" });
  const typeWrapper = node(meta, "div");
  const caption = node(typeWrapper, "label", "Type"); caption.htmlFor = `q-${q.uid}-type`;
  const select = node(typeWrapper, "select"); select.id = caption.htmlFor;
  for (const [value, text] of [["choice", "Choice"], ["noul", "Yes / No"], ["score", "Score"]]) {
    const option = node(select, "option", text); option.value = value;
  }
  select.value = q.type;
  field(card, "Instructions", `q-${q.uid}-instructions`, q.instructions, value => q.instructions = value, { required: true, multiline: true, placeholder: "What should the model decide from the state?" });
  const typeFields = node(card, "div", "", "type-fields");
  select.onchange = () => { q.type = select.value; renderType(q, typeFields); changed(); };
  renderType(q, typeFields);
  const error = node(card, "p", "", "question-error small error"); error.id = `q-${q.uid}-error`; error.hidden = true;
  const result = node(card, "div", "", "result"); result.id = `q-${q.uid}-result`; result.hidden = true;
  renderResult(q);
}

function renderCards() {
  el("questions").replaceChildren();
  questions.forEach(renderCard);
  update();
}

function bars(parent, probabilities) {
  for (const [label, probability] of Object.entries(probabilities)) {
    const row = node(parent, "div", "", "probability-row");
    node(row, "span", label); node(row, "span", `${(probability * 100).toFixed(1)}%`);
    const bar = node(parent, "div", "", "bar");
    const fill = node(bar, "span"); fill.style.width = `${Math.max(0, Math.min(100, probability * 100))}%`;
  }
}

function renderResult(q) {
  const box = el(`q-${q.uid}-result`);
  if (!box) return;
  box.replaceChildren(); box.hidden = !q.result;
  if (!q.result) return;
  if (q.resultStale) node(box, "p", "Input changed. This result belongs to the previous request.", "stale small");
  const { answer, name } = q.result;
  node(box, "h3", `Result · ${name}`);
  const headline = answer.type === "choice" ? answer.choice
    : answer.type === "noul" ? `P(yes) = ${(answer.noul * 100).toFixed(1)}%`
    : `Expected level = ${answer.score.toFixed(2)}`;
  node(box, "strong", headline);
  const probabilities = answer.type === "noul" ? { Yes: answer.noul, No: 1 - answer.noul }
    : Object.fromEntries(Object.entries(answer.probabilities).map(([key, value]) => [answer.type === "score" ? `${key}: ${answer.legend[key]}` : key, value]));
  bars(box, probabilities);
}

function clearResults() {
  el("raw").textContent = "No response yet.";
  el("permutation-result").replaceChildren();
  el("timing").textContent = "No request sent yet.";
  el("activity").textContent = "Add your state and questions, then run.";
  el("activity").className = "small";
  validationShown = false; showValidation([]);
}

function loadExample() {
  const example = examples.find(item => item.id === el("example").value);
  if (!example) { el("activity").textContent = "Choose an example to load first."; return; }
  sourceExample = example.id;
  el("state").value = example.request.state;
  questions = Object.entries(example.request.questions).map(([name, input]) => {
    const q = newQuestion(); q.name = name; q.type = input.type; q.instructions = input.instructions || "";
    if (q.type === "choice") q.choices = Object.entries(input.criteria).map(([name, description]) => ({ name, description: description || "" }));
    if (q.type === "score") q.levels = [...input.criteria];
    if (q.type === "noul") { q.yes = input.criteria?.true || ""; q.no = input.criteria?.false || ""; }
    return q;
  });
  clearResults(); renderCards();
  el("lesson").textContent = example.lesson;
  el("expected").textContent = Object.keys(example.expected).length
    ? "Expected labels: " + Object.entries(example.expected).map(([key, value]) => `${key} = ${value}`).join(", ")
    : "No gold label: inspect the distribution.";
  el("example-note").hidden = false;
}

function showPermutation(data, name) {
  const box = el("permutation-result"); box.replaceChildren();
  node(box, "p", `${name}: ` + (data.argmax_stable ? "winning option stayed stable." : "winning option changed."));
  for (const [i, run] of data.runs.entries()) {
    const item = node(box, "div", "", "permutation-run");
    node(item, "strong", `Run ${i + 1} · ${run.choice}`);
    node(item, "p", run.order.join(" → "), "small"); bars(item, run.probabilities);
  }
}

async function run(permutation = false) {
  if (busy || !modelReady) return;
  validationShown = true;
  const errors = issues(); showValidation(errors);
  if (errors.length) { el(errors[0].id)?.focus(); return; }
  const request = payload();
  const selected = questions.find(q => String(q.uid) === el("permutation-question").value && q.type === "choice");
  if (permutation && !selected) { el("activity").textContent = "Select a Choice question first."; return; }
  const targets = questions.map(q => ({ uid: q.uid, name: q.name.trim() }));
  const body = permutation ? { request, question: selected.name.trim(), n_perm: 6, seed: 42 } : request;
  busy = true; el("builder").disabled = true; update();
  el("activity").className = "small";
  el("activity").textContent = permutation ? "Running six option orders…" : "Running on the local GPU…";
  const started = performance.now();
  try {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180000);
    let response;
    try {
      response = await fetch(permutation ? "/v1/systemone/permute" : "/v1/systemone", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal
      });
    } finally { clearTimeout(timer); }
    const data = await response.json();
    if (!response.ok) throw Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
    const wall = Math.round(performance.now() - started);
    el("raw").textContent = JSON.stringify(data, null, 2);
    if (permutation) showPermutation(data, selected.name.trim());
    else for (const target of targets) {
      const q = questions.find(item => item.uid === target.uid);
      if (q && data.answers[target.name]) {
        q.result = { name: target.name, answer: data.answers[target.name] }; q.resultStale = false; renderResult(q);
      }
    }
    el("timing").textContent = `Round trip: ${wall} ms` + (data.latency_ms !== undefined ? ` · Model: ${data.latency_ms} ms` : "");
    const record = { timestamp: new Date().toISOString(), source_example: sourceExample,
      mode: permutation ? "permutation" : "decision", request, response: data, wall_ms: wall };
    if (permutation) record.permutation_question = selected.name.trim();
    history.push(record);
    node(el("history"), "div", `${history.length}. ${record.mode} · ${targets.map(q => q.name).join(", ")} · ${wall} ms`, "record");
    el("activity").textContent = permutation ? "Done. Inspect the option-order results." : "Done. Results are beneath each question.";
  } catch (error) {
    el("activity").textContent = error.name === "AbortError" ? "Request timed out. Check the server before retrying." : error.message;
    el("activity").className = "small error";
  } finally { busy = false; el("builder").disabled = false; update(); }
}

el("state").oninput = changed;
el("add-question").onclick = () => {
  const q = newQuestion(); questions.push(q); renderCard(q, questions.length - 1); changed(); el(`q-${q.uid}-name`).focus();
};
el("load-example").onclick = loadExample;
el("clear").onclick = () => {
  questions = []; sourceExample = null; el("state").value = ""; el("example").value = "";
  el("example-note").hidden = true; clearResults(); renderCards(); el("state").focus();
};
el("run").onclick = () => run();
el("shuffle").onclick = () => run(true);
el("export").onclick = () => {
  const content = { model: modelRun, records: history };
  // A regular HTTP attachment also works in browsers that restrict blob downloads.
  const form = document.createElement("form"); form.method = "POST"; form.action = "/lab/export";
  const input = document.createElement("input"); input.type = "hidden"; input.name = "session";
  input.value = JSON.stringify(content); form.append(input); document.body.append(form);
  form.submit(); form.remove();
};

(async () => {
  const [modelResult, examplesResult] = await Promise.allSettled([
    fetch("/v1/models").then(r => { if (!r.ok) throw Error("Local model is unavailable."); return r.json(); }),
    fetch("/lab/cases").then(r => { if (!r.ok) throw Error("Examples could not be loaded."); return r.json(); })
  ]);
  if (examplesResult.status === "fulfilled") {
    examples = examplesResult.value;
    for (const example of examples) { const option = node(el("example"), "option", example.title); option.value = example.id; }
  } else { el("load-example").disabled = true; }
  if (modelResult.status === "fulfilled") {
    const model = modelResult.value.models[0]; modelReady = true;
    modelRun = model.run;
    el("status").textContent = `Kev-0.8B · ${model.device} · ${model.dtype}`;
    el("activity").textContent = "Add your state and questions, then run.";
  } else {
    el("status").textContent = "Connection failed";
    el("activity").textContent = "Local model is unavailable. Start the server, then reload this page.";
    el("activity").className = "small error";
  }
  update();
})();
