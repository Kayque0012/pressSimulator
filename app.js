const $ = id => document.getElementById(id);

const PRESS_SIMULATOR_BUILD = "alpha11-module-aware-io";
window.PRESS_SIMULATOR_BUILD = PRESS_SIMULATOR_BUILD;

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

const simulatorSafeOutputs = Object.freeze([
  Object.freeze({ id: "OS1", key: "safetyValve", name: "Válvula pneumática de segurança" }),
  Object.freeze({ id: "OS2", key: "cylinderValve", name: "Válvula de avanço do cilindro" }),
  Object.freeze({ id: "OS3", key: "cylinderRetractValve", name: "Válvula de recuo do cilindro" }),
  Object.freeze({ id: "OS4", key: "safeOutput4", name: "Saída segura reserva 4" })
]);

const simulatorStatusOutputs = [
  { id: "ST1", key: "resetLed", name: "LED do reset" },
  { id: "ST2", key: "towerGreen", name: "Torre verde" },
  { id: "ST3", key: "towerYellow", name: "Torre amarela" },
  { id: "ST4", key: "towerRed", name: "Torre vermelha / buzzer" }
];

const simulatorOutputs = [...simulatorSafeOutputs, ...simulatorStatusOutputs];

const defaultIoMapping = {
  inputs: Object.fromEntries(simulatorInputs.map(item => [item.id, item.key])),
  outputs: Object.fromEntries(simulatorOutputs.map(item => [item.id, item.key]))
};

const STORAGE_KEY = "pressSimulatorIoMappingV3";

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
  cylinderRetractValve: false,
  cylinderCommandConflict: false,
  towerGreen: false,
  towerYellow: false,
  towerRed: false,
  resetLed: false,
  chockLed: false,
  buzzer: false,
  safeOutput3: false,
  safeOutput4: false
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

  // O endereço lógico pertence ao projeto MSX, não ao componente físico.
  // Por isso percorremos também endereços de módulos adicionais (ex.: M2.I1).
  const addresses = new Set([
    ...simulatorInputs.map(signal => signal.id),
    ...Object.keys(ioMapping.inputs || {}),
    ...(msxProject?.inputs || []).map(block => block.address).filter(Boolean)
  ]);

  addresses.forEach(address => {
    const mappedComponent = ioMapping.inputs[address];
    inputBus[address] = Boolean(physicalInputs[mappedComponent]);
  });
}

/* =========================================================
   PARSER E MOTOR MSX — ALFA
========================================================= */

let msxProject = null;
let msxRuntime = null;
let activeProgramMode = "demo";
let simulationRunning = true;

const MOSAIC_BLOCK_REGISTRY = {
  // I/O e roteamento
  IngressoItem: { type: "INPUT", level: "full", family: "I/O" },
  UscitaItem: { type: "OUTPUT", level: "full", family: "I/O" },
  SignalItem: { type: "PASS", level: "full", family: "Roteamento" },
  Splitter: { type: "PASS", level: "full", family: "Roteamento" },
  SplitterItem: { type: "PASS", level: "full", family: "Roteamento" },
  InterpaginaInItem: { type: "PASS", level: "full", family: "Roteamento" },
  InterpaginaOutItem: { type: "PASS", level: "full", family: "Roteamento" },
  MarkerInItem: { type: "PASS", level: "full", family: "Roteamento" },
  MarkerOutItem: { type: "PASS", level: "full", family: "Roteamento" },
  TerminatoreItem: { type: "TERMINATOR", level: "full", family: "Roteamento" },

  // Lógica booleana
  OrItem: { type: "OR", level: "full", family: "Lógica" },
  XOrItem: { type: "XOR", level: "full", family: "Lógica" },
  AndItem: { type: "AND", level: "full", family: "Lógica" },
  NOrItem: { type: "NOR", level: "full", family: "Lógica" },
  XNorItem: { type: "XNOR", level: "full", family: "Lógica" },
  NAndItem: { type: "NAND", level: "full", family: "Lógica" },
  NotItem: { type: "NOT", level: "full", family: "Lógica" },
  MultiplexItem: { type: "MULTIPLEX", level: "partial", family: "Lógica" },
  MacroLogicaItem: { type: "MACRO_LOGIC", level: "catalog", family: "Lógica" },
  DigitalComparatorItem: { type: "DIGITAL_COMPARATOR", level: "partial", family: "Lógica" },

  // Memórias
  FFItem: { type: "FF", level: "full", family: "Memória" },
  FlipFlopDItem: { type: "D_FF", level: "full", family: "Memória" },
  FlipFlopTItem: { type: "T_FF", level: "full", family: "Memória" },

  // Restart e segurança
  FungoItem: { type: "ESTOP", level: "full", family: "Segurança" },
  BimanualeItem: { type: "BIMANUAL", level: "full", family: "Segurança" },
  SwitchItem: { type: "SWITCH", level: "full", family: "Segurança" },
  OSSDConfigurabileItem: { type: "OSSD", level: "full", family: "Segurança" },
  RestartManualItem: { type: "RESTART_MANUAL", level: "full", family: "Restart" },
  RestartMonitoredItem: { type: "RESTART_MONITORED", level: "full", family: "Restart" },
  MacroRestartManualeItem: { type: "MACRO_RESTART_MANUAL", level: "catalog", family: "Restart" },
  MacroRestartMonitoratoItem: { type: "MACRO_RESTART_MONITORED", level: "catalog", family: "Restart" },
  PreResetItem: { type: "PRE_RESET", level: "catalog", family: "Restart" },
  GuardLockSafetyItem: { type: "GUARD_LOCK", level: "catalog", family: "Segurança" },
  OssdEdmItem: { type: "OSSD_EDM", level: "catalog", family: "Segurança" },
  ResetM1Item: { type: "RESET_M1", level: "catalog", family: "Sistema" },

  // Tempo e contagem
  CounterItem: { type: "COUNTER", level: "partial", family: "Contagem" },
  CounterComparatorItem: { type: "COUNTER_COMPARATOR", level: "partial", family: "Contagem" },
  DelayItem: { type: "DELAY", level: "partial", family: "Tempo" },
  LongDelayItem: { type: "LONG_DELAY", level: "partial", family: "Tempo" },
  LongDelayComparatorItem: { type: "LONG_DELAY_COMPARATOR", level: "catalog", family: "Tempo" },
  LineaRitardoItem: { type: "DELAY_LINE", level: "partial", family: "Tempo" },
  LongLineaRitardoItem: { type: "LONG_DELAY_LINE", level: "partial", family: "Tempo" },
  ClockingItem: { type: "CLOCK", level: "full", family: "Tempo" },
  MonostabileItem: { type: "MONOSTABLE", level: "full", family: "Tempo" },
  MonostabilePItem: { type: "MONOSTABLE_P", level: "full", family: "Tempo" },
  PassingItem: { type: "PASSING", level: "partial", family: "Tempo" },

  // Muting
  MutingLItem: { type: "MUTING_L", level: "catalog", family: "Muting" },
  MutingTItem: { type: "MUTING_T", level: "catalog", family: "Muting" },
  MutingSeqItem: { type: "MUTING_SEQ", level: "catalog", family: "Muting" },
  MutingSimItem: { type: "MUTING_SIM", level: "catalog", family: "Muting" },
  MutingOverrideItem: { type: "MUTING_OVERRIDE", level: "catalog", family: "Muting" },

  // Analógico, comunicação e sistema
  AnalogComparatorItem: { type: "ANALOG_COMPARATOR", level: "catalog", family: "Analógico" },
  AdderItem: { type: "ADDER", level: "catalog", family: "Analógico" },
  AnalogEqualityCheckItem: { type: "ANALOG_EQUALITY", level: "catalog", family: "Analógico" },
  SerialOutputItem: { type: "SERIAL_OUTPUT", level: "catalog", family: "Comunicação" },
  SerialCRCItem: { type: "SERIAL_CRC", level: "catalog", family: "Comunicação" },
  NetworkItem: { type: "NETWORK", level: "catalog", family: "Comunicação" }
};
/*
 * Disponibiliza o catálogo de blocos para os módulos da arquitetura V2.
 */
window.MOSAIC_BLOCK_REGISTRY = MOSAIC_BLOCK_REGISTRY;

console.info(
  "[PressSimulator] catálogo compartilhado com a V2:",
  Object.keys(MOSAIC_BLOCK_REGISTRY).length,
  "tipos"
);

const BLOCK_ALIASES = {
  INPUT: ["INPUT", "DIGITALINPUT", "IN", "SAFEINPUT", "LOGICINPUT", "INGRESSOITEM"],
  OUTPUT: ["OUTPUT", "DIGITALOUTPUT", "OUT", "SAFEOUTPUT", "LOGICOUTPUT", "USCITAITEM"],
  ESTOP: ["FUNGOITEM", "EMERGENCY", "ESTOP"],
  RESTART_MONITORED: ["RESTARTMONITOREDITEM", "RESTARTMONITORED"],
  RESTART_MANUAL: ["RESTARTMANUALITEM", "RESTARTMANUAL"],
  SWITCH: ["SWITCHITEM", "SWITCH"],
  BIMANUAL: ["BIMANUALEITEM", "BIMANUALITEM", "TWOHAND"],
  OSSD: ["OSSDCONFIGURABILEITEM", "OSSDITEM", "OSSD"],
  PASS: ["SIGNALITEM", "SPLITTER", "SPLITTERITEM", "INTERPAGINAINITEM", "INTERPAGINAOUTITEM", "MARKERINITEM", "MARKEROUTITEM"],
  CLOCK: ["CLOCKINGITEM", "CLOCK", "BLINK"],
  AND: ["AND", "ANDGATE", "LOGICAND"],
  OR: ["OR", "ORGATE", "LOGICOR"],
  XOR: ["XOR", "XORGATE", "LOGICXOR"],
  XNOR: ["XNOR", "XNORGATE", "LOGICXNOR"],
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

function getMosaicClassName(rawType) {
  const raw = String(rawType ?? "");
  const classMatch = raw.match(/Items\.([A-Za-z0-9_]+)/i);
  return classMatch ? classMatch[1] : raw.split(",")[0].split(".").pop();
}

function getBlockRegistration(rawType) {
  const className = getMosaicClassName(rawType);
  return MOSAIC_BLOCK_REGISTRY[className] || null;
}

function classifyBlock(rawType) {
  const registration = getBlockRegistration(rawType);
  if (registration) return registration.type;

  const raw = String(rawType ?? "");
  const fullToken = normalizeToken(raw);
  const className = getMosaicClassName(raw);
  const classToken = normalizeToken(className);
  const classWithoutItem = classToken.replace(/ITEM$/, "");
  const candidates = new Set([fullToken, classToken, classWithoutItem]);

  for (const [canonical, aliases] of Object.entries(BLOCK_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeToken);
    if (normalizedAliases.some(alias => candidates.has(alias))) return canonical;
  }

  for (const [canonical, aliases] of Object.entries(BLOCK_ALIASES)) {
    const match = aliases
      .map(normalizeToken)
      .filter(alias => alias.length >= 5)
      .some(alias => classToken.includes(alias) || classWithoutItem.includes(alias));
    if (match) return canonical;
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

  const decoded = new TextDecoder("utf-8").decode(buffer);
  const xmlStart = decoded.indexOf("<?xml");
  const diagramStart = decoded.indexOf("<MosaicDiagram");
  const start = xmlStart >= 0 ? xmlStart : diagramStart;
  const closingTag = "</MosaicDiagram>";
  const end = decoded.indexOf(closingTag);

  if (start >= 0 && end >= 0) {
    return decoded.slice(start, end + closingTag.length);
  }

  return decoded;
}

function detectBlockElements(xml) {
  const mosaicItems = [...xml.querySelectorAll("MosaicItem")];
  if (mosaicItems.length > 0) return mosaicItems;

  const all = [...xml.querySelectorAll("*")];
  return all.filter(element => {
    const tag = normalizeToken(element.tagName);
    const hasType = firstAttribute(element, ["type", "blockType", "function", "class", "kind", "name"]);
    const hasId = firstAttribute(element, ["id", "uid", "guid", "instanceId", "blockId", "ItemIdentifier"]);
    return hasId && hasType && (
      tag.includes("BLOCK") || tag.includes("FUNCTION") || tag.includes("ELEMENT") ||
      tag === "MOSAICITEM" || classifyBlock(hasType) !== "UNKNOWN"
    );
  });
}

function detectConnections(xml) {
  return [...xml.querySelectorAll("MosaicConnection, Connection, Wire, Link, Edge")]
    .map((element, index) => {
      const parameters = readElementParameters(element);
      const sourceId = firstAttribute(element, ["SourceId", "source", "from", "src", "fromBlock"]);
      const targetId = firstAttribute(element, ["SinkId", "TargetId", "target", "to", "dst", "toBlock"]);
      if (!sourceId || !targetId) return null;

      return {
        id: `C${index + 1}`,
        source: {
          blockId: sourceId,
          port: firstAttribute(element, ["SourceConnectorName", "sourcePort", "fromPort", "srcPort"]) || "OUT"
        },
        target: {
          blockId: targetId,
          port: firstAttribute(element, ["SinkConnectorName", "TargetConnectorName", "targetPort", "toPort", "dstPort"]) || "IN"
        }
      };
    })
    .filter(Boolean);
}

function buildIoModuleIndex(xml) {
  const groups = {
    Input: new Map(),
    Output: new Map(),
    OutputStatus: new Map()
  };

  [...xml.querySelectorAll("IOModule")].forEach(io => {
    const direction = io.getAttribute("Direction") || "";
    const moduleId = io.getAttribute("Module") || "SEM_MODULO";

    if (!groups[direction]) {
      groups[direction] = new Map();
    }

    if (!groups[direction].has(moduleId)) {
      groups[direction].set(moduleId, groups[direction].size);
    }
  });

  return groups;
}

function readMosaicIo(element, moduleIndex) {
  const io = element.querySelector(":scope > IOModule");
  if (!io) return null;

  const index = Number(io.getAttribute("Index"));
  const direction = io.getAttribute("Direction") || "";
  const moduleId = io.getAttribute("Module") || "SEM_MODULO";
  const moduleOrder = moduleIndex?.[direction]?.get(moduleId) ?? 0;

  let baseAddress = null;
  let group = null;

  if (direction === "Input") {
    baseAddress = `I${index + 1}`;
    group = "input";
  } else if (direction === "Output") {
    baseAddress = `OS${index + 1}`;
    group = "safeOutput";
  } else if (direction === "OutputStatus") {
    baseAddress = `ST${index + 1}`;
    group = "statusOutput";
  }

  if (!baseAddress) {
    return { index, direction, address: null, group: null, moduleId, moduleOrder };
  }

  // O índice do Mosaic reinicia em cada módulo. O módulo principal mantém
  // I1/OS1/ST1; módulos adicionais recebem prefixo para evitar colisão.
  const address = moduleOrder === 0
    ? baseAddress
    : `M${moduleOrder + 1}.${baseAddress}`;

  return {
    index,
    direction,
    address,
    baseAddress,
    group,
    moduleId,
    moduleOrder,
    moduleLabel: moduleOrder === 0 ? "M1S" : `Módulo ${moduleOrder + 1}`
  };
}

function readWireName(element) {
  return element.querySelector(":scope > ChangeNomeFilo")?.textContent?.trim() || null;
}

function parseMsxXml(xmlText, fileName = "projeto.msx") {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = xml.querySelector("parsererror");
  if (parserError) throw new Error("O conteúdo XML do MSX não pôde ser interpretado.");

  const ioModuleIndex = buildIoModuleIndex(xml);

  const blocks = detectBlockElements(xml).map((element, index) => {
    const parameters = readElementParameters(element);
    const id = firstAttribute(element, ["ItemIdentifier", "id", "uid", "guid", "instanceId", "blockId"]) || `B${index + 1}`;
    const rawType = firstAttribute(element, ["Type", "type", "blockType", "function", "class", "kind", "ItemName", "name"]) || element.tagName;
    const type = classifyBlock(rawType);
    const className = getMosaicClassName(rawType);
    const registration = getBlockRegistration(rawType);
    const io = readMosaicIo(element, ioModuleIndex);
    const description = element.querySelector(":scope > ChangeUserDescription")?.textContent?.trim();
    const wireName = readWireName(element);

    return {
      id: String(id),
      type,
      className,
      supportLevel: registration?.level || (type === "UNKNOWN" ? "unknown" : "partial"),
      family: registration?.family || "Não catalogado",
      rawType: String(rawType),
      name: description || wireName || firstAttribute(element, ["ItemName", "label", "displayName", "description", "name"]) || String(rawType),
      address: io?.address || null,
      baseAddress: io?.baseAddress || null,
      ioDirection: io?.direction || null,
      ioGroup: io?.group || null,
      ioModuleId: io?.moduleId || null,
      ioModuleOrder: io?.moduleOrder ?? null,
      ioModuleLabel: io?.moduleLabel || null,
      wireName,
      parameters
    };
  });

  const connections = detectConnections(xml);

  // Interliga os pares InterpaginaOut/InterpaginaIn que possuem o mesmo nome de fio.
  const wireOutputs = blocks.filter(block => normalizeToken(block.rawType).includes("INTERPAGINAOUTITEM") && block.wireName);
  const wireInputs = blocks.filter(block => normalizeToken(block.rawType).includes("INTERPAGINAINITEM") && block.wireName);
  wireOutputs.forEach(source => {
    wireInputs.filter(target => target.wireName === source.wireName).forEach((target, index) => {
      connections.push({
        id: `WIRE_${source.wireName}_${index}`,
        source: { blockId: source.id, port: "WIRE" },
        target: { blockId: target.id, port: "WIRE" }
      });
    });
  });

  return {
    fileName,
    version: xml.querySelector("Diagram")?.getAttribute("Version") || "desconhecida",
    blocks,
    connections,
    inputs: blocks.filter(block => block.ioGroup === "input"),
    safeOutputs: blocks.filter(block => block.ioGroup === "safeOutput"),
    statusOutputs: blocks.filter(block => block.ioGroup === "statusOutput"),
    outputs: blocks.filter(block => ["safeOutput", "statusOutput"].includes(block.ioGroup)),
    supportedBlocks: blocks.filter(block => block.supportLevel === "full"),
    partialBlocks: blocks.filter(block => block.supportLevel === "partial"),
    catalogBlocks: blocks.filter(block => block.supportLevel === "catalog"),
    unknownBlocks: blocks.filter(block => block.supportLevel === "unknown"),
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
      case "PASS":
      case "TERMINATOR":
        output = first;
        break;
      case "ESTOP": {
        const ch1 = inputs.TOPLEFT ?? inputs.IN1 ?? values[0] ?? false;
        const ch2 = inputs.BOTTOMLEFT ?? inputs.IN2 ?? values[1] ?? false;
        output = Boolean(ch1 && ch2);
        break;
      }
      case "RESTART_MANUAL": {
        const safetyInput = inputs.IN ?? inputs.TOPLEFT ?? values[0] ?? false;
        const resetInput = inputs.IMPULSO ?? inputs.RESET ?? inputs.IN2 ?? values[1] ?? false;
        if (!safetyInput) memory.q = false;
        else if (resetInput) memory.q = true;
        output = Boolean(memory.q && safetyInput);
        break;
      }
      case "RESTART_MONITORED": {
        const safetyInput = inputs.IN ?? inputs.TOPLEFT ?? values[0] ?? false;
        const resetInput = inputs.IMPULSO ?? inputs.RESET ?? inputs.IN2 ?? values[1] ?? false;
        const resetRising = Boolean(resetInput) && !Boolean(memory.previousReset);
        memory.previousReset = Boolean(resetInput);

        if (!safetyInput) {
          memory.q = false;
        } else if (resetRising) {
          memory.q = true;
        }

        output = Boolean(memory.q && safetyInput);
        break;
      }
      case "SWITCH":
      case "OSSD":
        output = first;
        break;
      case "BIMANUAL": {
        const left = inputs.IN1 ?? inputs.TOPLEFT ?? values[0] ?? false;
        const right = inputs.IN2 ?? inputs.BOTTOMLEFT ?? values[1] ?? false;
        output = Boolean(left && right);
        break;
      }
      case "CLOCK": {
        const rawTime = Number(findParameter(block.parameters, ["MemTempo", "PT", "time"], 50));
        // No ClockingItem do Mosaic, MemTempo trabalha em passos de 10 ms.
        // MemTempo=50 resulta em alternância a cada 500 ms.
        const halfPeriodMs = Math.max(10, rawTime * 10);
        output = first && Math.floor(now / halfPeriodMs) % 2 === 0;
        break;
      }
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
      case "XNOR":
        output = values.filter(Boolean).length % 2 === 0;
        break;
      case "MULTIPLEX": {
        const selector = inputs.SELECT ?? inputs.SEL ?? values[values.length - 1] ?? false;
        const data = values.slice(0, Math.max(1, values.length - 1));
        output = Boolean(data[selector ? 1 : 0] ?? data[0] ?? false);
        break;
      }
      case "DIGITAL_COMPARATOR": {
        const activeCount = values.filter(Boolean).length;
        const constantValue = Number(findParameter(block.parameters, ["MemCostanteComparazione"], 0));
        const comparatorType = Number(findParameter(block.parameters, ["MemTipoComparatore"], 4));
        if (comparatorType === 0) output = activeCount === constantValue;
        else if (comparatorType === 1) output = activeCount !== constantValue;
        else if (comparatorType === 2) output = activeCount > constantValue;
        else if (comparatorType === 3) output = activeCount < constantValue;
        else output = activeCount >= constantValue;
        break;
      }
      case "FF": {
        const set = inputs.SET ?? inputs.S ?? values[0] ?? false;
        const reset = inputs.RESET ?? inputs.R ?? values[1] ?? false;
        if (reset) memory.q = false;
        else if (set) memory.q = true;
        output = Boolean(memory.q);
        break;
      }
      case "D_FF": {
        const data = inputs.D ?? values[0] ?? false;
        const clock = inputs.CLOCK ?? inputs.CLK ?? values[1] ?? false;
        const rising = clock && !Boolean(memory.previousClock);
        memory.previousClock = Boolean(clock);
        if (rising) memory.q = Boolean(data);
        output = Boolean(memory.q);
        break;
      }
      case "T_FF": {
        const clock = inputs.T ?? inputs.CLOCK ?? inputs.CLK ?? values[0] ?? false;
        const rising = clock && !Boolean(memory.previousClock);
        memory.previousClock = Boolean(clock);
        if (rising) memory.q = !Boolean(memory.q);
        output = Boolean(memory.q);
        break;
      }
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
      case "MONOSTABLE":
      case "MONOSTABLE_P": {
        const rawTime = Number(findParameter(block.parameters, ["MemTempo", "PT", "time"], 1));
        const preset = Math.max(10, rawTime * 1000);
        const rising = first && !Boolean(memory.previous);
        memory.previous = first;
        if (rising) memory.pulseUntil = now + preset;
        output = now < Number(memory.pulseUntil || 0);
        break;
      }
      case "DELAY":
      case "LONG_DELAY":
      case "DELAY_LINE":
      case "LONG_DELAY_LINE": {
        const rawTime = Number(findParameter(block.parameters, ["MemTempo", "PT", "time"], 1));
        const preset = Math.max(10, rawTime * 1000);
        if (first) {
          if (!memory.startedAt) memory.startedAt = now;
          output = now - memory.startedAt >= preset;
        } else {
          memory.startedAt = null;
          output = false;
        }
        break;
      }
      case "PASSING": {
        const rawTime = Number(findParameter(block.parameters, ["MemTempo", "PT", "time"], 1));
        const preset = Math.max(10, rawTime * 1000);
        const falling = !first && Boolean(memory.previous);
        memory.previous = first;
        if (falling) memory.passUntil = now + preset;
        output = first || now < Number(memory.passUntil || 0);
        break;
      }
      case "COUNTER": {
        const pulse = inputs.IN ?? inputs.CLOCK ?? values[0] ?? false;
        const reset = inputs.RESET ?? values[1] ?? false;
        const rising = pulse && !Boolean(memory.previousPulse);
        memory.previousPulse = Boolean(pulse);
        if (reset) memory.count = 0;
        else if (rising) memory.count = Number(memory.count || 0) + 1;
        const preset = Number(findParameter(block.parameters, ["MemConteggio"], 2));
        output = Number(memory.count || 0) >= preset;
        break;
      }
      case "COUNTER_COMPARATOR": {
        const pulse = inputs.IN ?? inputs.CLOCK ?? values[0] ?? false;
        const reset = inputs.RESET ?? values[1] ?? false;
        const rising = pulse && !Boolean(memory.previousPulse);
        memory.previousPulse = Boolean(pulse);
        if (reset) memory.count = 0;
        else if (rising) memory.count = Number(memory.count || 0) + 1;
        const preset = Number(findParameter(block.parameters, ["MemConteggio"], 2));
        const comparatorType = Number(findParameter(block.parameters, ["MemTipoComparatore"], 1));
        if (comparatorType === 0) output = memory.count === preset;
        else if (comparatorType === 1) output = memory.count >= preset;
        else if (comparatorType === 2) output = memory.count > preset;
        else output = memory.count <= preset;
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

function clearProgramOutputs() {
  outputBus = createBooleanBus(simulatorOutputs);

  state.safetyValve = false;
  state.cylinderValve = false;
  state.cylinderRetractValve = false;
  state.cylinderCommandConflict = false;
  state.towerGreen = false;
  state.towerYellow = false;
  state.towerRed = false;
  state.resetLed = false;
  state.chockLed = false;
  state.buzzer = false;
  state.safeOutput3 = false;
  state.safeOutput4 = false;
}

function resetLoadedProjectState() {
  simulationRunning = false;
  msxRuntime?.reset();
  msxRuntime = null;
  msxProject = null;
  activeProgramMode = "demo";

  programMemory = {
    ready: false,
    automaticCycle: false,
    previousReset: false
  };

  clearProgramOutputs();
  updateRunButton();
}

function emptyIoMapping() {
  return {
    inputs: Object.fromEntries(simulatorInputs.map(item => [item.id, ""])),
    outputs: Object.fromEntries(simulatorOutputs.map(item => [item.id, ""]))
  };
}

function suggestInputMapping(block) {
  const name = normalizeToken(block.name);

  if (name.includes("EMG") || name.includes("EMERGEN")) {
    if (name.includes("CH2") || name.endsWith("2")) return "emergencyCH2";
    return "emergencyCH1";
  }
  if (name.includes("BIMANUAL")) {
    if (name.includes("CH2") || name.includes("DIR") || name.endsWith("2")) return "rightHand";
    return "leftHand";
  }
  if (name.includes("RESET") || name.includes("RESTART")) return "reset";
  if (name.includes("MANUAL")) return "manualMode";
  if (name.includes("AUTO")) return "automaticMode";
  if (name.includes("CORTINA") || name.includes("BARRIER") || name.includes("BARRIERE")) {
    if (name.includes("CH2") || name.endsWith("2")) return "curtainCH2";
    return "curtainCH1";
  }
  if (name.includes("RECU") || name.includes("RETRACT")) return "sensorRetracted";
  if (name.includes("AVANC") || name.includes("EXTEND")) return "sensorExtended";
  if (name.includes("CALCO") || name.includes("CHOCK")) return "chockSafe";
  return "";
}

function suggestOutputMapping(block) {
  const name = normalizeToken(block.name);

  if (name.includes("LED") && name.includes("RESET")) return "resetLed";
  if (name.includes("RECUA") || name.includes("RECUO") || name.includes("RETRAI") || name.includes("RETRACT")) return "cylinderRetractValve";
  if (name.includes("AVANCA") || name.includes("AVANCO") || name.includes("EXTEND")) return "cylinderValve";
  if (name.includes("SEGUR") || name.includes("PRESSUR") || name.includes("DUMP")) return "safetyValve";
  if (name.includes("VERDE") || name.includes("GREEN")) return "towerGreen";
  if (name.includes("AMAREL") || name.includes("YELLOW")) return "towerYellow";
  if (name.includes("VERMEL") || name.includes("RED")) return "towerRed";
  if (name.includes("BUZZ") || name.includes("SIREN") || name.includes("ALARME")) return "buzzer";
  return "";
}

function buildSuggestedMapping(project) {
  const next = emptyIoMapping();
  const usedInputTargets = new Set();
  const usedOutputTargets = new Set();

  project.inputs.forEach(block => {
    const suggestion = suggestInputMapping(block);
    if (block.address && suggestion && !usedInputTargets.has(suggestion)) {
      next.inputs[block.address] = suggestion;
      usedInputTargets.add(suggestion);
    }
  });

  project.outputs.forEach(block => {
    const suggestion = suggestOutputMapping(block);
    if (block.address && suggestion && !usedOutputTargets.has(suggestion)) {
      next.outputs[block.address] = suggestion;
      usedOutputTargets.add(suggestion);
    }
  });

  return next;
}

async function loadMsxFile(file) {
  // Uma importação sempre começa com motor, memórias, saídas e mapeamento limpos.
  resetLoadedProjectState();

  const buffer = await file.arrayBuffer();
  const xmlText = decodeProjectBuffer(buffer);
  const project = parseMsxXml(xmlText, file.name);

  if (project.blocks.length === 0) {
    throw new Error("Nenhum bloco foi identificado. Precisamos calibrar o parser com a estrutura deste MSX.");
  }

  msxProject = project;
  msxRuntime = new MsxRuntime(project);
  activeProgramMode = "msx";
  simulationRunning = false;

  // Não reaproveita mapeamento de outro projeto. Sugere somente os I/Os
  // realmente usados no arquivo recém-carregado.
  ioMapping = buildSuggestedMapping(project);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ioMapping));

  clearProgramOutputs();
  updateRunButton();
  return project;
}

function runActiveProgram() {
  if (!simulationRunning) {
    outputBus = createBooleanBus(simulatorOutputs);
    return;
  }

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
    `${project.safeOutputs.length} saídas seguras`,
    `${project.statusOutputs.length} saídas de status`,
    `${project.supportedBlocks.length} completos`,
    `${project.partialBlocks.length} parciais`,
    `${project.catalogBlocks.length} catalogados`,
    `${project.unknownBlocks.length} desconhecidos`
  ].join(" • ");

  log(`MSX analisado: ${summary}`);

  const newlySupported = project.blocks.filter(block =>
    ["RESTART_MONITORED", "SWITCH", "BIMANUAL", "OSSD"].includes(block.type)
  );
  if (newlySupported.length) {
    log(`Blocos de segurança reconhecidos: ${newlySupported.map(block => block.type).join(", ")}`);
  }

  console.table(project.inputs.map(block => ({ grupo: "Entrada", endereco: block.address, nome: block.name })));
  console.table(project.safeOutputs.map(block => ({ grupo: "Saída segura", endereco: block.address, nome: block.name })));
  console.table(project.statusOutputs.map(block => ({ grupo: "Saída de status", endereco: block.address, nome: block.name })));

  console.table(project.blocks.map(block => ({
    nome: block.name,
    classeOriginal: block.rawType,
    tipoInterpretado: block.type,
    suporte: block.supportLevel,
    familia: block.family,
    endereco: block.address || "-"
  })));


  if (project.catalogBlocks.length > 0) {
    log(`${project.catalogBlocks.length} blocos reconhecidos no catálogo ainda exigem teste funcional conectado`);
    console.table(project.catalogBlocks.map(block => ({
      classe: block.className,
      familia: block.family,
      estado: "CATALOGADO — sem semântica validada"
    })));
  }

  if (project.partialBlocks.length > 0) {
    log(`${project.partialBlocks.length} blocos possuem implementação inicial e precisam de validação`);
  }
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
    OS1: safetyValveCommand,
    OS2: cylinderCommand,
    OS3: false,
    OS4: false,
    ST1: safe && !programMemory.ready,
    ST2: safe && programMemory.ready,
    ST3: safe && !programMemory.ready,
    ST4: !safe
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

  const advanceCommand = Boolean(physicalOutputs.cylinderValve) && state.safetyValve;
  const retractCommand = Boolean(physicalOutputs.cylinderRetractValve) && state.safetyValve;
  const hasConflict = advanceCommand && retractCommand;

  state.cylinderCommandConflict = hasConflict;
  state.cylinderValve = advanceCommand && !hasConflict;
  state.cylinderRetractValve = retractCommand && !hasConflict;

  state.towerGreen = physicalOutputs.towerGreen;
  state.towerYellow = physicalOutputs.towerYellow;
  state.towerRed = physicalOutputs.towerRed;
  state.resetLed = physicalOutputs.resetLed;
  // O LED do calço não possui saída dedicada no M1S desta V1.
  // Portanto, sem um endereço explicitamente mapeado ele fica sempre apagado.
  state.chockLed = false;
  state.buzzer = physicalOutputs.buzzer;
  state.safeOutput4 = physicalOutputs.safeOutput4;
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

  // O LED não cria seu próprio pisca. Ele apenas reproduz o estado
  // instantâneo da saída física mapeada (por exemplo, ST1).
  led.classList.remove("blinking");
  led.classList.toggle("on", Boolean(state.resetLed));
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
    /*
   * Quando a arquitetura V2 estiver ativa,
   * o listener antigo não deve analisar o arquivo.
   */
  if (window.PRESS_SIMULATOR_USE_V2) {
    return;
  }
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  $("projectName").textContent = file.name;
  log(`Lendo arquivo: ${file.name}`);

  try {
    const project = await loadMsxFile(file);
    reportMsxProject(project);
    initializeMappingPage();
    openPage("io-map");
    log("Modo MSX ativado — revise e salve o mapeamento");
    evaluate();
  } catch (error) {
    resetLoadedProjectState();
    console.error(error);
    log(`Falha ao carregar MSX: ${error.message}`);
  }
});

/* =========================================================
   MAPA DE I/O FUNCIONAL
========================================================= */

function getMappingTargetsForSignal(signal, type) {
  if (type === "inputs") {
    return simulatorInputs;
  }

  const baseId = signal.id.split(".").pop();

  if (baseId.startsWith("OS")) {
    return simulatorSafeOutputs;
  }

  if (baseId.startsWith("ST")) {
    return simulatorStatusOutputs;
  }

  return simulatorOutputs;
}

function createMappingOptions(definitions, selectedKey = "") {
  const options = definitions.map(item => `
    <option value="${item.key}" ${item.key === selectedKey ? "selected" : ""}>
      ${item.name}
    </option>
  `).join("");

  return `<option value="">Não mapeado</option>${options}`;
}

function getProjectIoUsage() {
  const usage = {
    inputs: new Map(),
    outputs: new Map()
  };

  if (!msxProject) {
    return usage;
  }

  msxProject.inputs.forEach(block => usage.inputs.set(block.address, block));
  [...msxProject.safeOutputs, ...msxProject.statusOutputs]
    .forEach(block => usage.outputs.set(block.address, block));

  return usage;
}

function renderMappingRows(containerId, signals, type, projectUsage) {
  const container = $(containerId);
  if (!container) return;

  container.innerHTML = signals.map(signal => {
    const selectedKey = ioMapping[type][signal.id] || "";
    const targets = getMappingTargetsForSignal(signal, type);
    const projectBlock = projectUsage.get(signal.id);
    const usedByProject = Boolean(projectBlock);
    const groupLabel = signal.id.startsWith("OS")
      ? "Saída segura"
      : signal.id.startsWith("ST")
        ? "Saída de status"
        : "Entrada digital";
    const addressLabel = projectBlock?.ioModuleOrder > 0
      ? `${projectBlock.ioModuleLabel} · ${projectBlock.baseAddress}`
      : signal.id;

    const detail = usedByProject
      ? `${groupLabel} ${addressLabel} — ${projectBlock.name}`
      : `${groupLabel} ${signal.id} — não utilizado neste projeto`;

    return `
      <div
        class="mapping-row ${usedByProject ? "project-used" : "project-unused"}"
        data-signal-id="${signal.id}"
        data-project-used="${usedByProject}"
        style="${usedByProject ? "" : "opacity:.58"}"
      >
        <div class="mapping-signal-info">
          <strong>${signal.id}</strong>
          <span>${detail}</span>
        </div>
        <select
          class="mapping-select"
          data-signal-id="${signal.id}"
          data-signal-type="${type}"
          data-project-used="${usedByProject}"
          aria-label="Mapear ${signal.id}"
        >
          ${createMappingOptions(targets, selectedKey)}
        </select>
        <span class="mapping-row-status ${selectedKey ? "mapped" : ""}">${selectedKey ? "✓" : "○"}</span>
      </div>
    `;
  }).join("");
}

function updateMappingProgress() {
  const selects = [...document.querySelectorAll('.mapping-select[data-project-used="true"]')];
  const completed = selects.filter(select => select.value).length;

  if ($("mappingCompletedCount")) {
    $("mappingCompletedCount").textContent = `${completed} / ${selects.length}`;
  }

  document.querySelectorAll(".mapping-select").forEach(select => {
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
  const outputFamily = changedSelect.dataset.signalId.startsWith("OS")
    ? "OS"
    : changedSelect.dataset.signalId.startsWith("ST")
      ? "ST"
      : "I";

  document.querySelectorAll(`.mapping-select[data-signal-type="${type}"]`).forEach(select => {
    const selectFamily = select.dataset.signalId.startsWith("OS")
      ? "OS"
      : select.dataset.signalId.startsWith("ST")
        ? "ST"
        : "I";

    if (
      select !== changedSelect &&
      selectFamily === outputFamily &&
      select.value === changedSelect.value
    ) {
      select.value = "";
    }
  });
}

function readMappingFromPage() {
  const nextMapping = {
    inputs: { ...ioMapping.inputs },
    outputs: { ...ioMapping.outputs }
  };

  document.querySelectorAll(".mapping-select").forEach(select => {
    const type = select.dataset.signalType;
    nextMapping[type][select.dataset.signalId] = select.value;
  });

  return nextMapping;
}

function saveIoMapping() {
  pulseActionButton($("saveMappingButton"));
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

  msxRuntime?.reset();
  log("Mapeamento de I/O salvo e aplicado");

  if (activeProgramMode === "msx" && !simulationRunning) {
    log("Clique em Executar para iniciar o projeto MSX");
  }

  evaluate();
}

function getInputSignalsForMapping() {
  const signals = [...simulatorInputs];
  const known = new Set(signals.map(signal => signal.id));

  (msxProject?.inputs || []).forEach(block => {
    if (!block.address || known.has(block.address)) {
      return;
    }

    signals.push({
      id: block.address,
      key: "",
      name: `${block.ioModuleLabel || "Módulo adicional"} · ${block.baseAddress || block.address}`
    });
    known.add(block.address);
  });

  return signals;
}

function initializeMappingPage() {
  const usage = getProjectIoUsage();
  const inputSignals = getInputSignalsForMapping();

  // Mostra o M1S e também endereços usados em módulos adicionais do projeto.
  renderMappingRows("mappingInputs", inputSignals, "inputs", usage.inputs);
  renderMappingRows("mappingOutputs", simulatorOutputs, "outputs", usage.outputs);

  if ($("mappingInputCount")) {
    $("mappingInputCount").textContent = inputSignals.length;
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
   EXECUTAR / PARAR SIMULAÇÃO
========================================================= */

function updateRunButton() {
  const button = $("runButton");

  if (!button) {
    return;
  }

  button.textContent = simulationRunning ? "■ Parar" : "▶ Executar";
  button.classList.toggle("running", simulationRunning);
}

function pulseActionButton(button) {
  if (!button) return;
  button.classList.remove("action-confirmed");
  void button.offsetWidth;
  button.classList.add("action-confirmed");
  window.setTimeout(() => button.classList.remove("action-confirmed"), 380);
}

function handleRunButtonClick(event) {
  const button = event?.currentTarget || $("runButton");
  pulseActionButton(button);

  if (activeProgramMode === "msx" && !msxProject) {
    log("Carregue um arquivo MSX antes de executar");
    if (button) {
      button.textContent = "⚠ Carregue um MSX";
      window.setTimeout(updateRunButton, 1200);
    }
    return;
  }

  const unknownCount = Array.isArray(msxProject?.unknownBlocks)
    ? msxProject.unknownBlocks.length
    : 0;

  if (activeProgramMode === "msx" && unknownCount > 0) {
    log(`Execução bloqueada: ${unknownCount} bloco(s) desconhecido(s) no projeto`);
    if (button) {
      button.textContent = "⚠ Blocos desconhecidos";
      window.setTimeout(updateRunButton, 1400);
    }
    return;
  }

  simulationRunning = !simulationRunning;

  if (simulationRunning) {
    msxRuntime?.reset();
    log(activeProgramMode === "msx"
      ? "Execução do projeto MSX iniciada"
      : "Modo demonstração iniciado");
  } else {
    outputBus = createBooleanBus(simulatorOutputs);
    clearProgramOutputs();
    log("Simulação parada");
  }

  updateRunButton();
  evaluate();
}

function bindRunButton() {
  const button = $("runButton");

  if (!button) {
    console.error("[pressSimulator] botão #runButton não encontrado");
    return;
  }

  // Evita listeners duplicados caso a inicialização seja executada novamente.
  if (button.dataset.runBound === "true") {
    return;
  }

  button.dataset.runBound = "true";
  button.addEventListener("click", handleRunButtonClick);
  button.disabled = false;
  button.removeAttribute("aria-disabled");
  console.info("[pressSimulator] botão Executar vinculado");
}

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
let previousCylinderConflict = false;

function tick(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  let target = state.cylinder;

  if (state.cylinderValve) {
    target = 1;
  } else if (state.cylinderRetractValve) {
    target = 0;
  }

  const speed = 0.9;

  if (state.cylinder < target) {
    state.cylinder = Math.min(target, state.cylinder + speed * dt);
  }

  if (state.cylinder > target) {
    state.cylinder = Math.max(target, state.cylinder - speed * dt);
  }

  evaluate();

  if (state.cylinderCommandConflict !== previousCylinderConflict) {
    if (state.cylinderCommandConflict) {
      log("Conflito: avanço e recuo do cilindro ativos ao mesmo tempo. Movimento bloqueado.");
    } else if (previousCylinderConflict) {
      log("Conflito das válvulas do cilindro eliminado.");
    }
    previousCylinderConflict = state.cylinderCommandConflict;
  }

  requestAnimationFrame(tick);
}
/* =========================================================
   PONTE: PARSER V2 → MOTOR LÓGICO EXISTENTE
========================================================= */

window.addEventListener(
  "presssimulator:v2-project-ready",
  event => {
    const project =
      event.detail?.runtimeProject;

    if (!project) {
      log(
        "Parser V2 não entregou um projeto válido"
      );

      return;
    }

    try {
      resetLoadedProjectState();

      msxProject = project;

      msxRuntime =
        new MsxRuntime(msxProject);

      activeProgramMode = "msx";
      simulationRunning = false;

      ioMapping =
        buildSuggestedMapping(msxProject);

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(ioMapping)
      );

      clearProgramOutputs();

      initializeMappingPage();
      updateRunButton();

      reportMsxProject(msxProject);

      log(
        `Parser V2 assumiu o projeto: ${msxProject.fileName}`
      );

      if (msxProject.errors?.length) {
        log(
          `${msxProject.errors.length} erros de estrutura encontrados`
        );
      }

      if (
        msxProject.unknownBlocks.length > 0
      ) {
        log(
          `${msxProject.unknownBlocks.length} blocos desconhecidos impedem a execução`
        );
      } else {
        log(
          "Projeto V2 pronto. Clique em Executar."
        );
      }

      evaluate();
    } catch (error) {
      console.error(
        "[PressSimulator] Falha ao ativar projeto V2:",
        error
      );

      log(
        `Falha ao ativar parser V2: ${error.message}`
      );
    }
  }
);

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

initializeMappingPage();
bindRunButton();
updateRunButton();
log("Sistema iniciado");
log("Mapa de I/O funcional carregado");
log("Cilindro configurado com avanço, recuo e retenção de posição");
log("Splitter reconhecido como divisor passivo de sinal");
evaluate();
requestAnimationFrame(tick);


console.info(`[pressSimulator] build ${PRESS_SIMULATOR_BUILD}`);
