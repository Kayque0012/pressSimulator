const initialState = () => ({
  emergency: false,
  curtainBlocked: false,
  chockInserted: false,
  mode: "manual",
  left: false,
  right: false,
  reset: false,
  ready: false,
  safetyValve: false,
  valve: false,
  cylinder: 0
});

let state = initialState();

const $ = id => document.getElementById(id);

/* =========================================================
   COMPONENTES DISPONÍVEIS PARA O MAPEAMENTO
========================================================= */

const simulatorInputs = [
  { id: "I1", name: "Emergência CH1" },
  { id: "I2", name: "Emergência CH2" },
  { id: "I3", name: "Bimanual esquerdo" },
  { id: "I4", name: "Bimanual direito" },
  { id: "I5", name: "Cortina de luz CH1" },
  { id: "I6", name: "Cortina de luz CH2" },
  { id: "I7", name: "Botão reset" },
  { id: "I8", name: "Sensor cilindro recuado" },
  { id: "I9", name: "Sensor cilindro avançado" },
  { id: "I10", name: "Calço monitorado" },
  { id: "I11", name: "Seletora manual" },
  { id: "I12", name: "Seletora automático" }
];

const simulatorOutputs = [
  { id: "Q1", name: "Válvula pneumática de segurança" },
  { id: "Q2", name: "Válvula de avanço do cilindro" },
  { id: "Q3", name: "Torre verde" },
  { id: "Q4", name: "Torre amarela" },
  { id: "Q5", name: "Torre vermelha" },
  { id: "Q6", name: "LED do reset" },
  { id: "Q7", name: "LED do calço monitorado" },
  { id: "Q8", name: "Buzzer" }
];

const mappingTargets = {
  inputs: simulatorInputs.map(item => item.name),
  outputs: simulatorOutputs.map(item => item.name)
};


/* =========================================================
   ESTADO DA SIMULAÇÃO
========================================================= */

function isSafe() {
  return (
    !state.emergency &&
    !state.curtainBlocked &&
    !state.chockInserted
  );
}

function needsReset() {
  return (
    isSafe() &&
    !state.ready
  );
}

function hasPressure() {
  return state.safetyValve;
}

/* =========================================================
   EVENTOS
========================================================= */

function log(message) {
  const line = document.createElement("div");

  line.textContent =
    `${new Date().toLocaleTimeString()} ● ${message}`;

  $("events").prepend(line);

  syncFullEvents();
}

/* =========================================================
   LÓGICA TEMPORÁRIA DE DEMONSTRAÇÃO
========================================================= */

function evaluate() {
  if (!isSafe()) {
    state.ready = false;
    state.safetyValve = false;
    state.valve = false;
  } else {
    const twoHand =
      state.left &&
      state.right;

    if (state.mode === "manual") {
      state.valve =
        state.ready &&
        state.safetyValve &&
        twoHand;
    } else {
      if (
        state.ready &&
        state.safetyValve &&
        twoHand &&
        state.cylinder < 0.1
      ) {
        state.valve = true;
      }

      if (state.cylinder > 0.95) {
        state.valve = false;
      }
    }
  }

  render();
}

/* =========================================================
   TABELAS
========================================================= */

function renderTable(targetId, signals) {
  const target = $(targetId);

  if (!target) {
    return;
  }

  target.innerHTML = signals
    .map(([id, label, value]) => `
      <tr>
        <td>${id}</td>

        <td>${label}</td>

        <td>
          <span class="state-tag ${value ? "on" : ""}">
            ${value ? "ATIVO" : "INATIVO"}
          </span>
        </td>

        <td>
          ${value ? 1 : 0}

          <span class="state-dot ${value ? "on" : ""}">
          </span>
        </td>
      </tr>
    `)
    .join("");
}

/* =========================================================
   LED DE RESET
========================================================= */

function updateResetLed() {
  const led = $("resetLed");

  if (!led) {
    return;
  }

  led.classList.remove(
    "on",
    "blinking"
  );

  if (needsReset()) {
    led.classList.add("blinking");
    return;
  }

  if (
    state.ready &&
    isSafe()
  ) {
    led.classList.add("on");
  }
}

/* =========================================================
   PRESSÃO
========================================================= */

function updatePressure() {
  const pressureAvailable =
    hasPressure();

  $("pressureValue").textContent =
    pressureAvailable
      ? "5.2 bar"
      : "0.0 bar";

  $("pressureGauge").classList.toggle(
    "no-pressure",
    !pressureAvailable
  );

  $("pressureItem").classList.toggle(
    "pressure-off",
    !pressureAvailable
  );
}

/* =========================================================
   MONITOR DE I/O
========================================================= */

function syncMonitorTables() {
  if (
    !$("monitorInputTable") ||
    !$("monitorOutputTable")
  ) {
    return;
  }

  $("monitorInputTable").innerHTML =
    $("inputTable").innerHTML;

  $("monitorOutputTable").innerHTML =
    $("outputTable").innerHTML;
}

function syncFullEvents() {
  if (!$("fullEvents")) {
    return;
  }

  $("fullEvents").innerHTML =
    $("events").innerHTML;
}

/* =========================================================
   ATUALIZAÇÃO VISUAL
========================================================= */

function render() {
  const sensorRetracted =
    state.cylinder < 0.08;

  const sensorExtended =
    state.cylinder > 0.92;

  const pressureAvailable =
    hasPressure();

  /* Movimento do cilindro */

  $("ram").style.top =
    `${257 + state.cylinder * 82}px`;

  $("rod").style.height =
    `${98 + state.cylinder * 82}px`;

  /* Cortina */

  $("curtain").classList.toggle(
    "blocked",
    state.curtainBlocked
  );

  /* Emergência travada */

  $("emergency").classList.toggle(
    "active",
    state.emergency
  );

  /* Torre luminosa */

  $("lampRed").classList.toggle(
    "on",
    !isSafe()
  );

  $("lampYellow").classList.toggle(
    "on",
    needsReset()
  );

  $("lampGreen").classList.toggle(
    "on",
    state.ready && isSafe()
  );

  /* Calço */

  $("chock").classList.toggle(
    "active",
    state.chockInserted
  );

  $("chockLed").classList.toggle(
    "on",
    !state.chockInserted
  );


  /* Válvula pneumática de segurança */

  $("safetyValvePanel").classList.toggle(
    "energized",
    state.safetyValve
  );

  $("safetyValveBody").classList.toggle(
    "energized",
    state.safetyValve
  );

  $("safetyValveCoil").classList.toggle(
    "energized",
    state.safetyValve
  );

  $("safetyValveLed").classList.toggle(
    "on",
    state.safetyValve
  );

  $("safetyValveStatus").textContent =
    state.safetyValve
      ? "ENERGIZADA — SISTEMA PRESSURIZADO"
      : "DESENERGIZADA — SISTEMA EXAURIDO";

  $("safetyValveStatus").classList.toggle(
    "on",
    state.safetyValve
  );

  $("safetyValveStatus").classList.toggle(
    "off",
    !state.safetyValve
  );

  /* Sensores */

  $("sensorRet").textContent =
    sensorRetracted
      ? "ATIVO"
      : "INATIVO";

  $("sensorAdv").textContent =
    sensorExtended
      ? "ATIVO"
      : "INATIVO";

  $("sensorRetLed").classList.toggle(
    "green",
    sensorRetracted
  );

  $("sensorRetLed").classList.toggle(
    "on",
    sensorRetracted
  );

  $("sensorAdvLed").classList.toggle(
    "green",
    sensorExtended
  );

  $("sensorAdvLed").classList.toggle(
    "on",
    sensorExtended
  );

  /* Posição */

  const percentage =
    Math.round(
      state.cylinder * 100
    );

  $("positionBar").style.width =
    `${percentage}%`;

  $("miniFill").style.width =
    `${percentage}%`;

  let position =
    "EM MOVIMENTO";

  if (sensorRetracted) {
    position = "RECUADO";
  }

  if (sensorExtended) {
    position = "AVANÇADO";
  }

  $("positionText").textContent =
    position;

  /* I/O */

  const inputs = [
    ["I1", "Emergência CH1", !state.emergency],
    ["I2", "Emergência CH2", !state.emergency],
    ["I3", "Bimanual esquerdo", state.left],
    ["I4", "Bimanual direito", state.right],
    ["I5", "Cortina de luz CH1", !state.curtainBlocked],
    ["I6", "Cortina de luz CH2", !state.curtainBlocked],
    ["I7", "Botão reset", state.reset],
    ["I8", "Sensor cilindro recuado", sensorRetracted],
    ["I9", "Sensor cilindro avançado", sensorExtended],
    ["I10", "Calço monitorado", !state.chockInserted],
    ["I11", "Seletora manual", state.mode === "manual"],
    ["I12", "Seletora automático", state.mode === "automatic"]
  ];

  const outputs = [
    ["Q1", "Válvula pneumática de segurança", state.safetyValve],
    ["Q2", "Válvula de avanço do cilindro", state.valve],
    ["Q3", "Torre verde", state.ready && isSafe()],
    ["Q4", "Torre amarela", needsReset()],
    ["Q5", "Torre vermelha", !isSafe()],
    ["Q6", "LED do reset", needsReset()],
    ["Q7", "LED do calço monitorado", !state.chockInserted],
    ["Q8", "Buzzer", false]
  ];

  renderTable(
    "inputTable",
    inputs
  );

  renderTable(
    "outputTable",
    outputs
  );

  updateResetLed();
  updatePressure();
  syncMonitorTables();
  syncFullEvents();
}

/* =========================================================
   BOTÕES MOMENTÂNEOS
========================================================= */

function holdButton(id, key) {
  const element = $(id);

  [
    "mousedown",
    "touchstart"
  ].forEach(eventName => {
    element.addEventListener(
      eventName,
      event => {
        event.preventDefault();

        state[key] = true;

        element.classList.add(
          "active"
        );

        evaluate();
      }
    );
  });

  [
    "mouseup",
    "mouseleave",
    "touchend"
  ].forEach(eventName => {
    element.addEventListener(
      eventName,
      event => {
        event.preventDefault();

        state[key] = false;

        element.classList.remove(
          "active"
        );

        evaluate();
      }
    );
  });
}

holdButton(
  "leftHand",
  "left"
);

holdButton(
  "rightHand",
  "right"
);

/* =========================================================
   EMERGÊNCIA TRAVADA
========================================================= */

$("emergency").addEventListener(
  "click",
  () => {
    state.emergency =
      !state.emergency;

    log(
      state.emergency
        ? "Emergência acionada"
        : "Emergência destravada"
    );

    evaluate();
  }
);

/* =========================================================
   CORTINA
========================================================= */

$("curtainButton").addEventListener(
  "click",
  () => {
    state.curtainBlocked =
      !state.curtainBlocked;

    $("curtainButton").textContent =
      state.curtainBlocked
        ? "Liberar cortina"
        : "Interromper cortina";

    log(
      state.curtainBlocked
        ? "Cortina interrompida"
        : "Cortina liberada"
    );

    evaluate();
  }
);

/* =========================================================
   CALÇO
========================================================= */

$("chock").addEventListener(
  "click",
  () => {
    state.chockInserted =
      !state.chockInserted;

    log(
      state.chockInserted
        ? "Calço inserido"
        : "Calço removido"
    );

    evaluate();
  }
);

/* =========================================================
   SELETORA
========================================================= */

$("mode").addEventListener(
  "change",
  event => {
    state.mode =
      event.target.value;

    log(
      state.mode === "manual"
        ? "Modo manual selecionado"
        : "Modo automático selecionado"
    );

    evaluate();
  }
);

/* =========================================================
   RESET
========================================================= */

[
  "mousedown",
  "touchstart"
].forEach(eventName => {
  $("resetButton").addEventListener(
    eventName,
    event => {
      event.preventDefault();

      state.reset = true;

      $("resetButton").classList.add(
        "active"
      );

      if (isSafe()) {
        state.ready = true;
        state.safetyValve = true;

        log(
          "Reset aceito — máquina pronta"
        );
      }

      evaluate();
    }
  );
});

[
  "mouseup",
  "mouseleave",
  "touchend"
].forEach(eventName => {
  $("resetButton").addEventListener(
    eventName,
    event => {
      event.preventDefault();

      state.reset = false;

      $("resetButton").classList.remove(
        "active"
      );

      evaluate();
    }
  );
});

/* =========================================================
   ARQUIVO MSX
========================================================= */

$("msxFile").addEventListener(
  "change",
  event => {
    const file =
      event.target.files[0];

    if (!file) {
      return;
    }

    $("projectName").textContent =
      file.name;

    log(
      `Arquivo selecionado: ${file.name}`
    );
  }
);

/* =========================================================
   MAPA DE I/O
========================================================= */

function createMappingOptions(targets, selectedValue = "") {
  const defaultOption = `
    <option value="">Não mapeado</option>
  `;

  const options = targets
    .map(target => `
      <option value="${target}" ${target === selectedValue ? "selected" : ""}>
        ${target}
      </option>
    `)
    .join("");

  return defaultOption + options;
}

function renderMappingRows(containerId, signals, type) {
  const container = $(containerId);

  if (!container) {
    return;
  }

  const savedMapping = JSON.parse(
    localStorage.getItem("pressSimulatorIoMapping") || "{}"
  );

  const targets = mappingTargets[type];

  container.innerHTML = signals
    .map(signal => {
      const selectedValue = savedMapping[signal.id] || "";

      return `
        <div class="mapping-row" data-signal-id="${signal.id}">
          <div class="mapping-signal-info">
            <strong>${signal.id}</strong>
            <span>${type === "inputs" ? "Entrada" : "Saída"} digital ${signal.id.replace(/\D/g, "")}</span>
          </div>

          <select
            class="mapping-select"
            data-signal-id="${signal.id}"
            aria-label="Mapear ${signal.id}"
          >
            ${createMappingOptions(targets, selectedValue)}
          </select>

          <span class="mapping-row-status ${selectedValue ? "mapped" : ""}">
            ${selectedValue ? "✓" : "○"}
          </span>
        </div>
      `;
    })
    .join("");
}

function updateMappingProgress() {
  const selects = document.querySelectorAll(".mapping-select");
  const completed = [...selects].filter(select => select.value).length;
  const total = selects.length;

  if ($("mappingCompletedCount")) {
    $("mappingCompletedCount").textContent = `${completed} / ${total}`;
  }

  selects.forEach(select => {
    const row = select.closest(".mapping-row");
    const status = row?.querySelector(".mapping-row-status");
    const mapped = Boolean(select.value);

    row?.classList.toggle("mapped", mapped);

    if (status) {
      status.classList.toggle("mapped", mapped);
      status.textContent = mapped ? "✓" : "○";
    }
  });
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
    select.addEventListener("change", updateMappingProgress);
  });

  updateMappingProgress();
}

function saveIoMapping() {
  const mapping = {};

  document.querySelectorAll(".mapping-select").forEach(select => {
    mapping[select.dataset.signalId] = select.value;
  });

  localStorage.setItem(
    "pressSimulatorIoMapping",
    JSON.stringify(mapping)
  );

  const message = $("mappingSaveMessage");

  if (message) {
    message.textContent = "Mapeamento salvo neste navegador.";
    message.classList.add("visible");

    window.setTimeout(() => {
      message.classList.remove("visible");
    }, 2500);
  }

  log("Mapeamento de I/O salvo");
}

$("saveMappingButton")?.addEventListener(
  "click",
  saveIoMapping
);

/* =========================================================
   NAVEGAÇÃO
========================================================= */

const navItems =
  document.querySelectorAll(
    ".nav-item"
  );

const pages =
  document.querySelectorAll(
    ".page"
  );

function openPage(pageId) {
  pages.forEach(page => {
    page.classList.remove(
      "active-page"
    );
  });

  navItems.forEach(item => {
    item.classList.remove(
      "active"
    );
  });

  const targetPage =
    document.getElementById(
      pageId
    );

  if (targetPage) {
    targetPage.classList.add(
      "active-page"
    );
  }

  const targetButton =
    document.querySelector(
      `[data-page="${pageId}"]`
    );

  if (targetButton) {
    targetButton.classList.add(
      "active"
    );
  }
}

navItems.forEach(item => {
  item.addEventListener(
    "click",
    () => {
      openPage(
        item.dataset.page
      );
    }
  );
});

$("openIoMapButton").addEventListener(
  "click",
  () => {
    openPage("io-map");
  }
);

$("openSettingsButton").addEventListener(
  "click",
  () => {
    openPage("settings");
  }
);

$("clearEventsButton").addEventListener(
  "click",
  () => {
    $("events").innerHTML = "";
    $("fullEvents").innerHTML = "";
  }
);

/* =========================================================
   TECLADO
========================================================= */

document.addEventListener(
  "keydown",
  event => {
    if (event.repeat) {
      return;
    }

    const key =
      event.key.toLowerCase();

    if (key === "a") {
      state.left = true;

      $("leftHand").classList.add(
        "active"
      );
    }

    if (key === "d") {
      state.right = true;

      $("rightHand").classList.add(
        "active"
      );
    }

    if (key === "e") {
      state.emergency =
        !state.emergency;

      log(
        state.emergency
          ? "Emergência acionada"
          : "Emergência destravada"
      );
    }

    if (key === "m") {
      state.mode =
        state.mode === "manual"
          ? "automatic"
          : "manual";

      $("mode").value =
        state.mode;

      log(
        state.mode === "manual"
          ? "Modo manual selecionado"
          : "Modo automático selecionado"
      );
    }

    if (event.code === "Space") {
      event.preventDefault();

      state.reset = true;

      $("resetButton").classList.add(
        "active"
      );

      if (isSafe()) {
        state.ready = true;
        state.safetyValve = true;
      }
    }

    evaluate();
  }
);

document.addEventListener(
  "keyup",
  event => {
    const key =
      event.key.toLowerCase();

    if (key === "a") {
      state.left = false;

      $("leftHand").classList.remove(
        "active"
      );
    }

    if (key === "d") {
      state.right = false;

      $("rightHand").classList.remove(
        "active"
      );
    }

    if (event.code === "Space") {
      state.reset = false;

      $("resetButton").classList.remove(
        "active"
      );
    }

    evaluate();
  }
);

/* =========================================================
   ANIMAÇÃO
========================================================= */

let last =
  performance.now();

function tick(now) {
  const dt =
    Math.min(
      (now - last) / 1000,
      0.05
    );

  last = now;

  const target =
    state.valve
      ? 1
      : 0;

  const speed = 0.9;

  if (
    state.cylinder < target
  ) {
    state.cylinder =
      Math.min(
        target,
        state.cylinder + speed * dt
      );
  }

  if (
    state.cylinder > target
  ) {
    state.cylinder =
      Math.max(
        target,
        state.cylinder - speed * dt
      );
  }

  render();

  requestAnimationFrame(tick);
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

initializeMappingPage();

log("Sistema iniciado");
log("Modo demonstração ativo");

evaluate();

requestAnimationFrame(tick);
