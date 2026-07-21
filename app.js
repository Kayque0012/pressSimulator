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
   PARSER E MOTOR MSX — ALFA
========================================================= */

let msxProject = null;
let msxRuntime = null;
let activeProgramMode = "demo";

const BLOCK_ALIASES = {
  INPUT: ["INPUT", "DIGITALINPUT", "IN", "SAFEINPUT", "LOGICINPUT"],
  OUTPUT: ["OUTPUT", "DIGITALOUTPUT", "OUT", "SAFEOUTPUT", "LOGICOUTPUT"],
  AND: ["AND", "ANDGATE", "LOGICAND"],
  OR: ["OR", "ORGATE", "LOGICOR"],
  XOR: ["XOR", "XORGATE", "LOGICXOR"],
  NOT: ["NOT", "INVERTER", "NEGATE"],
  NAND: ["NAND"],
  NOR: ["NOR"],
  RS: ["RS", "RSLATCH", "RESETSET"],
  SR: ["SR", "SRLATCH", "SETRESET"],
  R_TRIG: ["RTRIG", "R_TRIG", "RISINGEDGE", "POSEDGE", "POSITIVEEDGE"],
  F_TRIG: ["FTRIG", "F_TRIG", "FALLINGEDGE", "NEGEDGE", "NEGATIVEEDGE"],
  TON: ["TON", "ONDELAY", "TIMERON", "TIMERONDELAY"],
  TOF: ["TOF", "OFFDELAY", "TIMEROFF", "TIMEROFFDELAY"],
  TP: ["TP", "PULSE", "MONOFLOP", "MONOSTABLE"],
  CONST_TRUE: ["TRUE", "CONSTTRUE", "CONSTANTTRUE"],
  CONST_FALSE: ["FALSE", "CONSTFALSE", "CONSTANTFALSE"]
};

function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toUpperCase();
}

function classifyBlock(rawType) {
  const token = normalizeToken(rawType);

  for (const [canonical, aliases] of Object.entries(BLOCK_ALIASES)) {
    if (aliases.some(alias => token === normalizeToken(alias) || token.includes(normalizeToken(alias)))) {
      return canonical;
    }
  }

  return "UNKNOWN";
}

function firstAttribute(element, names) {
  for (const name of names) {
    if (element.hasAttribute(name)) {
      return element.getAttribute(name);
    }

    const found = [...element.attributes].find(attribute =>
      normalizeToken(attribute.name) === normalizeToken(name)
    );

    if (found) {
      return found.value;
    }
  }

  return null;
}

function leafChildValues(element) {
  const values = {};

  [...element.children].forEach(child => {
    if (child.children.length === 0) {
      const text = child.textContent?.trim();
      if (text) values[child.tagName] = text;
    }
  });

  return values;
}

function readElementParameters(element) {
  const parameters = {};

  [...element.attributes].forEach(attribute => {
    parameters[attribute.name] = attribute.value;
  });

  return { ...parameters, ...leafChildValues(element) };
}

function parseDurationMs(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return value;

  const text = String(value).trim().toUpperCase().replace(",", ".");

  const iso = text.match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (iso) {
    return ((Number(iso[1] || 0) * 3600) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0)) * 1000;
  }

  const unit = text.match(/^(-?\d+(?:\.\d+)?)\s*(MS|S|SEC|M|MIN)?$/);
  if (!unit) return fallback;

  const number = Number(unit[1]);
  const suffix = unit[2] || "MS";
  if (suffix === "S" || suffix === "SEC") return number * 1000;
  if (suffix === "M" || suffix === "MIN") return number * 60000;
  return number;
}

function findParameter(parameters, candidates, fallback = null) {
  const entries = Object.entries(parameters);

  for (const candidate of candidates) {
    const found = entries.find(([key]) => normalizeToken(key) === normalizeToken(candidate));
    if (found) return found[1];
  }

  return fallback;
}

function parseEndpoint(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^(.+?)[.:/\\](.+)$/);

  if (match) {
    return { blockId: match[1], port: match[2] };
  }

  return { blockId: text, port: "OUT" };
}

function decodeProjectBuffer(buffer) {
  const bytes = new Uint8Array(buffer);

  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error("Este MSX parece compactado em ZIP. Precisaremos adicionar o descompactador na próxima calibração.");
  }

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }

  return new TextDecoder("utf-8").decode(buffer);
}

function detectBlockElements(xml) {
  const all = [...xml.querySelectorAll("*")];

  return all.filter(element => {
    const tag = normalizeToken(element.tagName);
    const hasType = firstAttribute(element, ["type", "blockType", "function", "class", "kind", "name"]);
    const hasId = firstAttribute(element, ["id", "uid", "guid", "instanceId", "blockId"]);

    return hasId && hasType && (
      tag.includes("BLOCK") ||
      tag.includes("FUNCTION") ||
      tag.includes("ELEMENT") ||
      classifyBlock(hasType) !== "UNKNOWN"
    );
  });
}

function detectConnections(xml) {
  const all = [...xml.querySelectorAll("*")];
  const connections = [];

  all.forEach((element, index) => {
    const tag = normalizeToken(element.tagName);
    if (!["CONNECTION", "CONNECT", "WIRE", "LINK", "EDGE"].some(word => tag.includes(word))) return;

    const parameters = readElementParameters(element);
    const sourceRaw = findParameter(parameters, ["source", "from", "src", "sourceId", "fromBlock"]);
    const targetRaw = findParameter(parameters, ["target", "to", "dst", "targetId", "toBlock"]);

    if (!sourceRaw || !targetRaw) return;

    const sourcePort = findParameter(parameters, ["sourcePort", "fromPort", "srcPort"], null);
    const targetPort = findParameter(parameters, ["targetPort", "toPort", "dstPort"], null);
    const source = parseEndpoint(sourceRaw);
    const target = parseEndpoint(targetRaw);

    if (sourcePort) source.port = sourcePort;
    if (targetPort) target.port = targetPort;

    connections.push({ id: `C${index + 1}`, source, target });
  });

  return connections;
}

function extractAddress(parameters, direction) {
  const candidates = direction === "input"
    ? ["address", "channel", "input", "inputAddress", "io", "name"]
    : ["address", "channel", "output", "outputAddress", "io", "name"];

  const raw = findParameter(parameters, candidates, "");
  const match = String(raw).toUpperCase().match(direction === "input" ? /I\s*0*(\d+)/ : /Q\s*0*(\d+)/);
  return match ? `${direction === "input" ? "I" : "Q"}${Number(match[1])}` : null;
}

function parseMsxXml(xmlText, fileName = "projeto.msx") {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("O arquivo não contém um XML válido ou usa uma codificação ainda não reconhecida.");
  }

  const blocks = detectBlockElements(xml).map((element, index) => {
    const parameters = readElementParameters(element);
    const id = firstAttribute(element, ["id", "uid", "guid", "instanceId", "blockId"]) || `B${index + 1}`;
    const rawType = firstAttribute(element, ["type", "blockType", "function", "class", "kind", "name"]) || element.tagName;
    const type = classifyBlock(rawType);
    const direction = type === "INPUT" ? "input" : type === "OUTPUT" ? "output" : null;

    return {
      id: String(id),
      type,
      rawType: String(rawType),
      name: firstAttribute(element, ["label", "displayName", "description", "name"]) || String(rawType),
      address: direction ? extractAddress(parameters, direction) : null,
      parameters
    };
  });

  const connections = detectConnections(xml);
  const supportedBlocks = blocks.filter(block => block.type !== "UNKNOWN");
  const unknownBlocks = blocks.filter(block => block.type === "UNKNOWN");

  return {
    fileName,
    blocks,
    connections,
    inputs: blocks.filter(block => block.type === "INPUT"),
    outputs: blocks.filter(block => block.type === "OUTPUT"),
    supportedBlocks,
    unknownBlocks,
    parsedAt: new Date().toISOString()
  };
}

class MsxRuntime {
  constructor(project) {
    this.project = project;
    this.memory = new Map();
    this.values = new Map();
    this.incoming = new Map();

    project.connections.forEach(connection => {
      const list = this.incoming.get(connection.target.blockId) || [];
      list.push(connection);
      this.incoming.set(connection.target.blockId, list);
    });
  }

  reset() {
    this.memory.clear();
    this.values.clear();
  }

  getInputs(block) {
    const connections = this.incoming.get(block.id) || [];
    const inputs = {};

    connections.forEach((connection, index) => {
      const sourceValue = Boolean(this.values.get(connection.source.blockId));
      inputs[normalizeToken(connection.target.port || `IN${index + 1}`)] = sourceValue;
      inputs[`IN${index + 1}`] = sourceValue;
    });

    return inputs;
  }

  evaluateBlock(block, inputBusSnapshot, now) {
    const inputs = this.getInputs(block);
    const values = Object.values(inputs);
    const first = values[0] ?? false;
    const memory = this.memory.get(block.id) || {};
    let output = false;

    switch (block.type) {
      case "INPUT":
        output = Boolean(inputBusSnapshot[block.address]);
        break;
      case "OUTPUT":
        output = first;
        break;
      case "AND":
        output = values.length > 0 && values.every(Boolean);
        break;
      case "OR":
        output = values.some(Boolean);
        break;
      case "XOR":
        output = values.filter(Boolean).length % 2 === 1;
        break;
      case "NOT":
        output = !first;
        break;
      case "NAND":
        output = !(values.length > 0 && values.every(Boolean));
        break;
      case "NOR":
        output = !values.some(Boolean);
        break;
      case "CONST_TRUE":
        output = true;
        break;
      case "CONST_FALSE":
        output = false;
        break;
      case "R_TRIG":
        output = first && !Boolean(memory.previous);
        memory.previous = first;
        break;
      case "F_TRIG":
        output = !first && Boolean(memory.previous);
        memory.previous = first;
        break;
      case "RS": {
        const set = inputs.S ?? inputs.SET ?? values[0] ?? false;
        const reset = inputs.R ?? inputs.RESET ?? values[1] ?? false;
        memory.q = reset ? false : set ? true : Boolean(memory.q);
        output = memory.q;
        break;
      }
      case "SR": {
        const set = inputs.S ?? inputs.SET ?? values[0] ?? false;
        const reset = inputs.R ?? inputs.RESET ?? values[1] ?? false;
        memory.q = set ? true : reset ? false : Boolean(memory.q);
        output = memory.q;
        break;
      }
      case "TON": {
        const preset = parseDurationMs(findParameter(block.parameters, ["PT", "time", "delay", "preset"], 0));
        if (first) {
          if (!memory.startedAt) memory.startedAt = now;
          output = now - memory.startedAt >= preset;
        } else {
          memory.startedAt = null;
          output = false;
        }
        break;
      }
      case "TOF": {
        const preset = parseDurationMs(findParameter(block.parameters, ["PT", "time", "delay", "preset"], 0));
        if (first) {
          memory.offStartedAt = null;
          output = true;
        } else {
          if (!memory.offStartedAt) memory.offStartedAt = now;
          output = now - memory.offStartedAt < preset;
        }
        break;
      }
      case "TP": {
        const preset = parseDurationMs(findParameter(block.parameters, ["PT", "time", "pulse", "preset"], 0));
        const rising = first && !Boolean(memory.previous);
        memory.previous = first;
        if (rising) memory.pulseUntil = now + preset;
        output = now < Number(memory.pulseUntil || 0);
        break;
      }
      default:
        output = false;
    }

    this.memory.set(block.id, memory);
    this.values.set(block.id, Boolean(output));
    return Boolean(output);
  }

  scan(inputBusSnapshot) {
    const now = performance.now();
    const outputSnapshot = createBooleanBus(simulatorOutputs);

    this.project.blocks.filter(block => block.type === "INPUT").forEach(block => {
      this.evaluateBlock(block, inputBusSnapshot, now);
    });

    const processBlocks = this.project.blocks.filter(block => !["INPUT", "OUTPUT"].includes(block.type));
    const passes = Math.max(2, Math.min(processBlocks.length + 1, 30));

    for (let pass = 0; pass < passes; pass += 1) {
      let changed = false;

      processBlocks.forEach(block => {
        const before = this.values.get(block.id);
        const after = this.evaluateBlock(block, inputBusSnapshot, now);
        if (before !== after) changed = true;
      });

      if (!changed) break;
    }

    this.project.blocks.filter(block => block.type === "OUTPUT").forEach(block => {
      const value = this.evaluateBlock(block, inputBusSnapshot, now);
      if (block.address && block.address in outputSnapshot) {
        outputSnapshot[block.address] = value;
      }
    });

    return outputSnapshot;
  }
}

async function loadMsxFile(file) {
  const buffer = await file.arrayBuffer();
  const xmlText = decodeProjectBuffer(buffer);
  const project = parseMsxXml(xmlText, file.name);

  if (project.blocks.length === 0) {
    throw new Error("Nenhum bloco foi identificado. Precisamos calibrar o parser com a estrutura deste MSX.");
  }

  msxProject = project;
  msxRuntime = new MsxRuntime(project);
  activeProgramMode = "msx";

  return project;
}

function runActiveProgram() {
  if (activeProgramMode === "msx" && msxRuntime) {
    outputBus = msxRuntime.scan(inputBus);
    return;
  }

  runDemoProgram();
}

function reportMsxProject(project) {
  const summary = [
    `${project.blocks.length} blocos`,
    `${project.connections.length} conexões`,
    `${project.inputs.length} entradas`,
    `${project.outputs.length} saídas`,
    `${project.unknownBlocks.length} não reconhecidos`
  ].join(" • ");

  log(`MSX analisado: ${summary}`);

  if (project.unknownBlocks.length > 0) {
    console.table(project.unknownBlocks.map(block => ({
      id: block.id,
      tipoOriginal: block.rawType,
      nome: block.name
    })));
  }
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
  runActiveProgram();
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

$("msxFile")?.addEventListener("change", async event => {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  $("projectName").textContent = file.name;
  log(`Lendo arquivo: ${file.name}`);

  try {
    const project = await loadMsxFile(file);
    reportMsxProject(project);
    log("Modo MSX ativado");
    evaluate();
  } catch (error) {
    activeProgramMode = "demo";
    msxProject = null;
    msxRuntime = null;
    console.error(error);
    log(`Falha ao carregar MSX: ${error.message}`);
  }
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
