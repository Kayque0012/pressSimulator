const $ = id => document.getElementById(id);

/* =========================================================
   DEFINIÇÃO DOS COMPONENTES FÍSICOS
========================================================= */

const simulatorInputs = [
  { id: "I1", key: "emergencyCH1", name: "Emergência CH1" },
  { id: "I2", key: "emergencyCH2", name: "Emergência CH2" },
  { id: "I3", key: "leftHand", name: "Bimanual esquerdo" },
  { id: "I4", key: "rightHand", name: "Bimanual direito" },
  { id: "I5", key: "curtainCH1", name: "Cortina de luz CH1" },
  { id: "I6", key: "curtainCH2", name: "Cortina de luz CH2" },
  { id: "I7", key: "reset", name: "Botão reset" },
  { id: "I8", key: "sensorRetracted", name: "Sensor cilindro recuado" },
  { id: "I9", key: "sensorExtended", name: "Sensor cilindro avançado" },
  { id: "I10", key: "chockSafe", name: "Calço monitorado" },
  { id: "I11", key: "manualMode", name: "Seletora manual" },
  { id: "I12", key: "automaticMode", name: "Seletora automático" }
];

const simulatorOutputs = [
  { id: "Q1", key: "safetyValve", name: "Válvula pneumática de segurança" },
  { id: "Q2", key: "cylinderValve", name: "Válvula de avanço do cilindro" },
  { id: "Q3", key: "towerGreen", name: "Torre verde" },
  { id: "Q4", key: "towerYellow", name: "Torre amarela" },
  { id: "Q5", key: "towerRed", name: "Torre vermelha" },
  { id: "Q6", key: "resetLed", name: "LED do reset" },
  { id: "Q7", key: "chockLed", name: "LED do calço monitorado" },
  { id: "Q8", key: "buzzer", name: "Buzzer" }
];

const defaultIoMapping = {
  inputs: Object.fromEntries(simulatorInputs.map(item => [item.id, item.key])),
  outputs: Object.fromEntries(simulatorOutputs.map(item => [item.id, item.key]))
};

const STORAGE_KEY = "pressSimulatorIoMappingV2";

/* =========================================================
   ESTADO FÍSICO, BARRAMENTOS E MEMÓRIA DO PROGRAMA
========================================================= */

const initialState = () => ({
  emergency: false,
  curtainBlocked: false,
  chockInserted: false,
  mode: "manual",
  left: false,
  right: false,
  reset: false,
  cylinder: 0,

  safetyValve: false,
  cylinderValve: false,
  towerGreen: false,
  towerYellow: false,
  towerRed: false,
  resetLed: false,
  chockLed: false,
  buzzer: false
});

let state = initialState();
let ioMapping = loadIoMapping();
let inputBus = createBooleanBus(simulatorInputs);
let outputBus = createBooleanBus(simulatorOutputs);
let programMemory = {
  ready: false,
  automaticCycle: false,
  previousReset: false
};

function createBooleanBus(definitions) {
  return Object.fromEntries(definitions.map(item => [item.id, false]));
}

function cloneDefaultMapping() {
  return {
    inputs: { ...defaultIoMapping.inputs },
    outputs: { ...defaultIoMapping.outputs }
  };
}

function loadIoMapping() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");

    if (!saved || typeof saved !== "object") {
      return cloneDefaultMapping();
    }

    return {
      inputs: { ...defaultIoMapping.inputs, ...(saved.inputs || {}) },
      outputs: { ...defaultIoMapping.outputs, ...(saved.outputs || {}) }
    };
  } catch (error) {
    console.warn("Mapeamento inválido. Restaurando padrão.", error);
    return cloneDefaultMapping();
  }
}

/* =========================================================
   AQUISIÇÃO DAS ENTRADAS FÍSICAS
========================================================= */

function getPhysicalInputStates() {
  const sensorRetracted = state.cylinder < 0.08;
  const sensorExtended = state.cylinder > 0.92;

  return {
    emergencyCH1: !state.emergency,
    emergencyCH2: !state.emergency,
    leftHand: state.left,
    rightHand: state.right,
    curtainCH1: !state.curtainBlocked,
    curtainCH2: !state.curtainBlocked,
    reset: state.reset,
    sensorRetracted,
    sensorExtended,
    chockSafe: !state.chockInserted,
    manualMode: state.mode === "manual",
    automaticMode: state.mode === "automatic"
  };
}

function refreshInputBus() {
  const physicalInputs = getPhysicalInputStates();

  simulatorInputs.forEach(signal => {
    const mappedComponent = ioMapping.inputs[signal.id];
    inputBus[signal.id] = Boolean(physicalInputs[mappedComponent]);
  });
}

/* =========================================================
   PROGRAMA DEMONSTRATIVO — SUBSTITUÍDO PELO MSX NO FUTURO
========================================================= */

function runDemoProgram() {
  const safe =
    inputBus.I1 &&
    inputBus.I2 &&
    inputBus.I5 &&
    inputBus.I6 &&
    inputBus.I10;

  const resetRisingEdge = inputBus.I7 && !programMemory.previousReset;
  programMemory.previousReset = inputBus.I7;

  if (!safe) {
    programMemory.ready = false;
    programMemory.automaticCycle = false;
  }

  if (safe && resetRisingEdge) {
    programMemory.ready = true;
    log("Reset aceito — programa rearmado");
  }

  const twoHand = inputBus.I3 && inputBus.I4;
  const manualMode = inputBus.I11;
  const automaticMode = inputBus.I12;
  const sensorRetracted = inputBus.I8;
  const sensorExtended = inputBus.I9;

  if (automaticMode && programMemory.ready && twoHand && sensorRetracted) {
    programMemory.automaticCycle = true;
  }

  if (sensorExtended || !safe || !automaticMode) {
    programMemory.automaticCycle = false;
  }

  const safetyValveCommand = safe && programMemory.ready;
  const cylinderCommand = safetyValveCommand && (
    (manualMode && twoHand) ||
    (automaticMode && programMemory.automaticCycle)
  );

  outputBus = {
    Q1: safetyValveCommand,
    Q2: cylinderCommand,
    Q3: safe && programMemory.ready,
    Q4: safe && !programMemory.ready,
    Q5: !safe,
    Q6: safe && !programMemory.ready,
    Q7: inputBus.I10,
    Q8: false
  };
}

/* =========================================================
   APLICAÇÃO DAS SAÍDAS À MÁQUINA FÍSICA
========================================================= */

function applyOutputBus() {
  const physicalOutputs = Object.fromEntries(
    simulatorOutputs.map(item => [item.key, false])
  );

  simulatorOutputs.forEach(signal => {
    const mappedComponent = ioMapping.outputs[signal.id];

    if (mappedComponent in physicalOutputs) {
      physicalOutputs[mappedComponent] =
        physicalOutputs[mappedComponent] || Boolean(outputBus[signal.id]);
    }
  });

  state.safetyValve = physicalOutputs.safetyValve;
  state.cylinderValve = physicalOutputs.cylinderValve && state.safetyValve;
  state.towerGreen = physicalOutputs.towerGreen;
  state.towerYellow = physicalOutputs.towerYellow;
  state.towerRed = physicalOutputs.towerRed;
  state.resetLed = physicalOutputs.resetLed;
  state.chockLed = physicalOutputs.chockLed;
  state.buzzer = physicalOutputs.buzzer;
}

function evaluate() {
  refreshInputBus();
  runDemoProgram();
  applyOutputBus();
  render();
}

/* =========================================================
   EVENTOS
========================================================= */

function log(message) {
  const events = $("events");

  if (!events) {
    return;
  }

  const line = document.createElement("div");
  line.textContent = `${new Date().toLocaleTimeString()} ● ${message}`;
  events.prepend(line);
  syncFullEvents();
}

/* =========================================================
   TABELAS DE I/O
========================================================= */

function getDefinitionByKey(definitions, key) {
  return definitions.find(item => item.key === key);
}

function renderTable(targetId, definitions, bus, mappingGroup) {
  const target = $(targetId);

  if (!target) {
    return;
  }

  target.innerHTML = definitions.map(signal => {
    const mappedKey = ioMapping[mappingGroup][signal.id];
    const mappedDefinition = getDefinitionByKey(definitions, mappedKey);
    const label = mappedDefinition?.name || "Não mapeado";
    const value = Boolean(bus[signal.id]);

    return `
      <tr>
        <td>${signal.id}</td>
        <td>${label}</td>
        <td>
          <span class="state-tag ${value ? "on" : ""}">
            ${value ? "ATIVO" : "INATIVO"}
          </span>
        </td>
        <td>
          ${value ? 1 : 0}
          <span class="state-dot ${value ? "on" : ""}"></span>
        </td>
      </tr>
    `;
  }).join("");
}

function syncMonitorTables() {
  if ($("monitorInputTable") && $("inputTable")) {
    $("monitorInputTable").innerHTML = $("inputTable").innerHTML;
  }

  if ($("monitorOutputTable") && $("outputTable")) {
    $("monitorOutputTable").innerHTML = $("outputTable").innerHTML;
  }
}

function syncFullEvents() {
  if ($("fullEvents") && $("events")) {
    $("fullEvents").innerHTML = $("events").innerHTML;
  }
}

/* =========================================================
   ATUALIZAÇÃO VISUAL
========================================================= */

function render() {
  const sensorRetracted = state.cylinder < 0.08;
  const sensorExtended = state.cylinder > 0.92;

  $("ram").style.top = `${257 + state.cylinder * 82}px`;
  $("rod").style.height = `${98 + state.cylinder * 82}px`;

  $("curtain").classList.toggle("blocked", state.curtainBlocked);
  $("emergency").classList.toggle("active", state.emergency);
  $("chock").classList.toggle("active", state.chockInserted);

  $("lampRed").classList.toggle("on", state.towerRed);
  $("lampYellow").classList.toggle("on", state.towerYellow);
  $("lampGreen").classList.toggle("on", state.towerGreen);

  updateResetLed();
  $("chockLed").classList.toggle("on", state.chockLed);

  updateSafetyValveVisual();
  updatePressure();

  $("sensorRet").textContent = sensorRetracted ? "ATIVO" : "INATIVO";
  $("sensorAdv").textContent = sensorExtended ? "ATIVO" : "INATIVO";
  $("sensorRetLed").classList.toggle("green", sensorRetracted);
  $("sensorRetLed").classList.toggle("on", sensorRetracted);
  $("sensorAdvLed").classList.toggle("green", sensorExtended);
  $("sensorAdvLed").classList.toggle("on", sensorExtended);

  const percentage = Math.round(state.cylinder * 100);
  $("positionBar").style.width = `${percentage}%`;
  $("miniFill").style.width = `${percentage}%`;
  $("positionText").textContent = sensorRetracted
    ? "RECUADO"
    : sensorExtended
      ? "AVANÇADO"
      : "EM MOVIMENTO";

  renderTable("inputTable", simulatorInputs, inputBus, "inputs");
  renderTable("outputTable", simulatorOutputs, outputBus, "outputs");
  syncMonitorTables();
  syncFullEvents();
}

function updateResetLed() {
  const led = $("resetLed");

  if (!led) {
    return;
  }

  led.classList.remove("on", "blinking");

  if (state.resetLed) {
    led.classList.add("blinking");
  } else if (programMemory.ready) {
    led.classList.add("on");
  }
}

function updateSafetyValveVisual() {
  const energized = state.safetyValve;

  $("safetyValvePanel")?.classList.toggle("energized", energized);
  $("safetyValveBody")?.classList.toggle("energized", energized);
  $("safetyValveCoil")?.classList.toggle("energized", energized);
  $("safetyValveLed")?.classList.toggle("on", energized);

  if ($("safetyValveStatus")) {
    $("safetyValveStatus").textContent = energized
      ? "ENERGIZADA — SISTEMA PRESSURIZADO"
      : "DESENERGIZADA — SISTEMA EXAURIDO";
    $("safetyValveStatus").classList.toggle("on", energized);
    $("safetyValveStatus").classList.toggle("off", !energized);
  }
}

function updatePressure() {
  const pressureAvailable = state.safetyValve;

  $("pressureValue").textContent = pressureAvailable ? "5.2 bar" : "0.0 bar";
  $("pressureGauge").classList.toggle("no-pressure", !pressureAvailable);
  $("pressureItem").classList.toggle("pressure-off", !pressureAvailable);
}

/* =========================================================
   INTERAÇÕES FÍSICAS
========================================================= */

function holdButton(id, stateKey) {
  const element = $(id);

  if (!element) {
    return;
  }

  ["mousedown", "touchstart"].forEach(eventName => {
    element.addEventListener(eventName, event => {
      event.preventDefault();
      state[stateKey] = true;
      element.classList.add("active");
      evaluate();
    });
  });

  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach(eventName => {
    element.addEventListener(eventName, event => {
      event.preventDefault();
      state[stateKey] = false;
      element.classList.remove("active");
      evaluate();
    });
  });
}

holdButton("leftHand", "left");
holdButton("rightHand", "right");
holdButton("resetButton", "reset");

$("emergency")?.addEventListener("click", () => {
  state.emergency = !state.emergency;
  log(state.emergency ? "Emergência acionada" : "Emergência destravada");
  evaluate();
});

$("curtainButton")?.addEventListener("click", () => {
  state.curtainBlocked = !state.curtainBlocked;
  $("curtainButton").textContent = state.curtainBlocked
    ? "Liberar cortina"
    : "Interromper cortina";
  log(state.curtainBlocked ? "Cortina interrompida" : "Cortina liberada");
  evaluate();
});

$("chock")?.addEventListener("click", () => {
  state.chockInserted = !state.chockInserted;
  log(state.chockInserted ? "Calço inserido" : "Calço removido");
  evaluate();
});

$("mode")?.addEventListener("change", event => {
  state.mode = event.target.value;
  log(state.mode === "manual" ? "Modo manual selecionado" : "Modo automático selecionado");
  evaluate();
});

$("msxFile")?.addEventListener("change", event => {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  $("projectName").textContent = file.name;
  log(`Arquivo selecionado: ${file.name}`);
});

/* =========================================================
   MAPA DE I/O FUNCIONAL
========================================================= */

function createMappingOptions(definitions, selectedKey = "") {
  const options = definitions.map(item => `
    <option value="${item.key}" ${item.key === selectedKey ? "selected" : ""}>
      ${item.name}
    </option>
  `).join("");

  return `<option value="">Não mapeado</option>${options}`;
}

function renderMappingRows(containerId, signals, type) {
  const container = $(containerId);

  if (!container) {
    return;
  }

  const targets = type === "inputs" ? simulatorInputs : simulatorOutputs;

  container.innerHTML = signals.map(signal => {
    const selectedKey = ioMapping[type][signal.id] || "";

    return `
      <div class="mapping-row" data-signal-id="${signal.id}">
        <div class="mapping-signal-info">
          <strong>${signal.id}</strong>
          <span>${type === "inputs" ? "Entrada" : "Saída"} digital ${signal.id.replace(/\D/g, "")}</span>
        </div>

        <select
          class="mapping-select"
          data-signal-id="${signal.id}"
          data-signal-type="${type}"
          aria-label="Mapear ${signal.id}"
        >
          ${createMappingOptions(targets, selectedKey)}
        </select>

        <span class="mapping-row-status ${selectedKey ? "mapped" : ""}">
          ${selectedKey ? "✓" : "○"}
        </span>
      </div>
    `;
  }).join("");
}

function updateMappingProgress() {
  const selects = [...document.querySelectorAll(".mapping-select")];
  const completed = selects.filter(select => select.value).length;

  if ($("mappingCompletedCount")) {
    $("mappingCompletedCount").textContent = `${completed} / ${selects.length}`;
  }

  selects.forEach(select => {
    const mapped = Boolean(select.value);
    const row = select.closest(".mapping-row");
    const status = row?.querySelector(".mapping-row-status");

    row?.classList.toggle("mapped", mapped);

    if (status) {
      status.classList.toggle("mapped", mapped);
      status.textContent = mapped ? "✓" : "○";
    }
  });
}

function preventDuplicateMapping(changedSelect) {
  if (!changedSelect.value) {
    return;
  }

  const type = changedSelect.dataset.signalType;

  document.querySelectorAll(`.mapping-select[data-signal-type="${type}"]`).forEach(select => {
    if (select !== changedSelect && select.value === changedSelect.value) {
      select.value = "";
    }
  });
}

function readMappingFromPage() {
  const nextMapping = { inputs: {}, outputs: {} };

  document.querySelectorAll(".mapping-select").forEach(select => {
    const type = select.dataset.signalType;
    nextMapping[type][select.dataset.signalId] = select.value;
  });

  return nextMapping;
}

function saveIoMapping() {
  ioMapping = readMappingFromPage();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ioMapping));

  const message = $("mappingSaveMessage");

  if (message) {
    message.textContent = "Mapeamento salvo e aplicado ao simulador.";
    message.classList.add("visible");
    window.setTimeout(() => message.classList.remove("visible"), 2500);
  }

  programMemory = {
    ready: false,
    automaticCycle: false,
    previousReset: false
  };

  log("Mapeamento de I/O salvo e aplicado");
  evaluate();
}

function initializeMappingPage() {
  renderMappingRows("mappingInputs", simulatorInputs, "inputs");
  renderMappingRows("mappingOutputs", simulatorOutputs, "outputs");

  if ($("mappingInputCount")) {
    $("mappingInputCount").textContent = simulatorInputs.length;
  }

  if ($("mappingOutputCount")) {
    $("mappingOutputCount").textContent = simulatorOutputs.length;
  }

  document.querySelectorAll(".mapping-select").forEach(select => {
    select.addEventListener("change", () => {
      preventDuplicateMapping(select);
      updateMappingProgress();
    });
  });

  updateMappingProgress();
}

$("saveMappingButton")?.addEventListener("click", saveIoMapping);

/* =========================================================
   NAVEGAÇÃO
========================================================= */

const navItems = document.querySelectorAll(".nav-item");
const pages = document.querySelectorAll(".page");

function openPage(pageId) {
  pages.forEach(page => page.classList.remove("active-page"));
  navItems.forEach(item => item.classList.remove("active"));

  document.getElementById(pageId)?.classList.add("active-page");
  document.querySelector(`[data-page="${pageId}"]`)?.classList.add("active");
}

navItems.forEach(item => {
  item.addEventListener("click", () => openPage(item.dataset.page));
});

$("openIoMapButton")?.addEventListener("click", () => openPage("io-map"));
$("openSettingsButton")?.addEventListener("click", () => openPage("settings"));
$("clearEventsButton")?.addEventListener("click", () => {
  if ($("events")) $("events").innerHTML = "";
  if ($("fullEvents")) $("fullEvents").innerHTML = "";
});

/* =========================================================
   TECLADO
========================================================= */

function setKeyboardButton(key, active) {
  const mapping = {
    a: ["left", "leftHand"],
    d: ["right", "rightHand"]
  };

  const target = mapping[key];

  if (!target) {
    return false;
  }

  state[target[0]] = active;
  $(target[1])?.classList.toggle("active", active);
  return true;
}

document.addEventListener("keydown", event => {
  if (event.repeat) {
    return;
  }

  const key = event.key.toLowerCase();

  if (setKeyboardButton(key, true)) {
    evaluate();
    return;
  }

  if (key === "e") {
    state.emergency = !state.emergency;
    log(state.emergency ? "Emergência acionada" : "Emergência destravada");
    evaluate();
    return;
  }

  if (key === "m") {
    state.mode = state.mode === "manual" ? "automatic" : "manual";
    $("mode").value = state.mode;
    log(state.mode === "manual" ? "Modo manual selecionado" : "Modo automático selecionado");
    evaluate();
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    state.reset = true;
    $("resetButton")?.classList.add("active");
    evaluate();
  }
});

document.addEventListener("keyup", event => {
  const key = event.key.toLowerCase();

  if (setKeyboardButton(key, false)) {
    evaluate();
    return;
  }

  if (event.code === "Space") {
    state.reset = false;
    $("resetButton")?.classList.remove("active");
    evaluate();
  }
});

/* =========================================================
   ANIMAÇÃO DO CILINDRO
========================================================= */

let lastFrame = performance.now();

function tick(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  const target = state.cylinderValve ? 1 : 0;
  const speed = 0.9;

  if (state.cylinder < target) {
    state.cylinder = Math.min(target, state.cylinder + speed * dt);
  }

  if (state.cylinder > target) {
    state.cylinder = Math.max(target, state.cylinder - speed * dt);
  }

  evaluate();
  requestAnimationFrame(tick);
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

initializeMappingPage();
log("Sistema iniciado");
log("Mapa de I/O funcional carregado");
evaluate();
requestAnimationFrame(tick);
